import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { PromptBlock } from '../../prompts'
import type { LocalCommandRecord } from '../commands/registry'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath'

const MAX_CLAUDE_MD_CHARS = 200_000
const MAX_AUTO_MEMORY_LINES = 200
const MAX_BASH_MODE_OUTPUT_CHARS = 30_000

const TRUNCATED_MARKER = '\n\n(Truncated)\n'

export type ClaudeMdFileMeta = {
  scope: 'global' | 'project'
  filePath: string
  sizeBytes: number
  mtimeMs: number
  includedSha256: string
  originalChars: number
  includedChars: number
  truncated: boolean
}

export type ClaudeMdInjectionMeta = {
  capChars: number
  global: ClaudeMdFileMeta | null
  project: ClaudeMdFileMeta | null
  memory: AutoMemoryFileMeta | null
}

export type AutoMemoryFileMeta = {
  filePath: string
  sizeBytes: number
  mtimeMs: number
  includedSha256: string
  originalLines: number
  includedLines: number
  truncated: boolean
}

function truncateWithMarker(input: string, maxChars: number): string {
  const limit = Math.max(0, maxChars)
  if (input.length <= limit) return input
  if (limit <= TRUNCATED_MARKER.length) return TRUNCATED_MARKER.slice(0, limit)
  return input.slice(0, limit - TRUNCATED_MARKER.length) + TRUNCATED_MARKER
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

type OptionalFileRaw = { filePath: string; contents: string; sizeBytes: number; mtimeMs: number }

function readOptionalFileRaw(filePath: string): OptionalFileRaw | null {
  if (!fs.existsSync(filePath)) return null

  try {
    const stat = fs.statSync(filePath)
    const contents = fs.readFileSync(filePath, 'utf8')
    return { filePath, contents, sizeBytes: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

type ClaudeMdSource = OptionalFileRaw & {
  scope: 'global' | 'project'
  includedSha256: string
  originalChars: number
  includedChars: number
  truncated: boolean
}

type AutoMemorySource = OptionalFileRaw & {
  includedSha256: string
  originalLines: number
  includedLines: number
  truncated: boolean
}

function getClaudeMdPaths(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): { globalClaudeMdPath: string; projectClaudeMdPath: string } {
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir ?? os.homedir()
  const configPaths = getConfigPaths({ cwd: args.cwd, env, platform, homedir })
  const globalClaudeMdPath = path.join(path.resolve(args.cwd, configPaths.globalConfigDir), 'CLAUDE.md')
  const projectClaudeMdPath = path.join(args.cwd, 'CLAUDE.md')
  return { globalClaudeMdPath, projectClaudeMdPath }
}

function getAutoMemoryPath(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): string {
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir ?? os.homedir()
  const configPaths = getConfigPaths({ cwd: args.cwd, env, platform, homedir })
  const memoryDir = buildAutoMemoryDirectoryPath({
    cwd: args.cwd,
    configDir: configPaths.globalConfigDir,
  })
  return path.join(memoryDir, 'MEMORY.md')
}

function splitToLines(input: string): string[] {
  if (!input) return []
  const normalized = input.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function truncateToLineLimit(input: string, maxLines: number): {
  contents: string
  originalLines: number
  includedLines: number
  truncated: boolean
} {
  const limit = Math.max(0, maxLines)
  const lines = splitToLines(input)
  const originalLines = lines.length
  if (originalLines <= limit) {
    return {
      contents: input,
      originalLines,
      includedLines: originalLines,
      truncated: false,
    }
  }

  return {
    contents: lines.slice(0, limit).join('\n'),
    originalLines,
    includedLines: limit,
    truncated: true,
  }
}

function readAndCapAutoMemory(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): AutoMemorySource | null {
  const memoryPath = getAutoMemoryPath(args)
  const raw = readOptionalFileRaw(memoryPath)
  if (!raw) return null

  const { contents, originalLines, includedLines, truncated } = truncateToLineLimit(
    raw.contents,
    MAX_AUTO_MEMORY_LINES,
  )

  return {
    ...raw,
    contents,
    includedSha256: sha256Hex(contents),
    originalLines,
    includedLines,
    truncated,
  }
}

function readAndCapClaudeMd(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): { global: ClaudeMdSource | null; project: ClaudeMdSource | null } {
  const { globalClaudeMdPath, projectClaudeMdPath } = getClaudeMdPaths(args)

  const globalRaw = readOptionalFileRaw(globalClaudeMdPath)
  const projectRaw = readOptionalFileRaw(projectClaudeMdPath)

  const global = globalRaw ? { ...globalRaw, scope: 'global' as const } : null
  const project = projectRaw ? { ...projectRaw, scope: 'project' as const } : null
  if (!global && !project) return { global: null, project: null }

  const cap = MAX_CLAUDE_MD_CHARS

  const projectOriginal = project ? project.contents.length : 0
  if (project) project.contents = truncateWithMarker(project.contents, cap)
  const projectIncluded = project ? project.contents.length : 0

  const remainingForGlobal = cap - projectIncluded
  const globalOriginal = global ? global.contents.length : 0
  if (global) {
    global.contents =
      remainingForGlobal > 0
        ? truncateWithMarker(global.contents, remainingForGlobal)
        : ''
  }
  const globalIncluded = global ? global.contents.length : 0

  const toSource = (
    raw: (OptionalFileRaw & { scope: 'global' | 'project' }) | null,
    originalChars: number,
    includedChars: number,
  ): ClaudeMdSource | null => {
    if (!raw) return null
    return {
      ...raw,
      includedSha256: sha256Hex(raw.contents),
      originalChars,
      includedChars,
      truncated: includedChars < originalChars,
    }
  }

  return {
    global: toSource(global, globalOriginal, globalIncluded),
    project: toSource(project, projectOriginal, projectIncluded),
  }
}

export function getClaudeMdInjectionMeta(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  includeAutoMemory?: boolean
}): ClaudeMdInjectionMeta {
  const { global, project } = readAndCapClaudeMd(args)
  const memory = args.includeAutoMemory === false ? null : readAndCapAutoMemory(args)

  const toMeta = (src: ClaudeMdSource | null): ClaudeMdFileMeta | null => {
    if (!src) return null
    return {
      scope: src.scope,
      filePath: src.filePath,
      sizeBytes: src.sizeBytes,
      mtimeMs: src.mtimeMs,
      includedSha256: src.includedSha256,
      originalChars: src.originalChars,
      includedChars: src.includedChars,
      truncated: src.truncated,
    }
  }

  const memoryMeta: AutoMemoryFileMeta | null = memory
    ? {
        filePath: memory.filePath,
        sizeBytes: memory.sizeBytes,
        mtimeMs: memory.mtimeMs,
        includedSha256: memory.includedSha256,
        originalLines: memory.originalLines,
        includedLines: memory.includedLines,
        truncated: memory.truncated,
      }
    : null

  return {
    capChars: MAX_CLAUDE_MD_CHARS,
    global: toMeta(global),
    project: toMeta(project),
    memory: memoryMeta,
  }
}

export function buildClaudeMdInjectedBlocks(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  includeAutoMemory?: boolean
}): PromptBlock[] {
  const { global, project } = readAndCapClaudeMd(args)
  const memory = args.includeAutoMemory === false ? null : readAndCapAutoMemory(args)
  if (!global && !project && !memory) return []

  const text =
    '<system-reminder>\n' +
    "As you answer the user's questions, you can use the following context:\n" +
    '# claudeMd\n' +
    'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
    'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n' +
    'Precedence: project instructions override global user instructions.\n\n' +
    (global && global.contents.trim()
      ? `Contents of ${global.filePath} (global user instructions, optional):\n\n${global.contents}\n\n`
      : '') +
    (project && project.contents.trim()
      ? `Contents of ${project.filePath} (project instructions, checked into the codebase):\n\n${project.contents}\n\n`
      : '') +
    (memory
      ? `Contents of ${memory.filePath} (user's auto-memory, persists across conversations):\n\n${memory.contents}\n\n`
      : '') +
    '\n\n' +
    'IMPORTANT: this context may or may not be relevant to your tasks. ' +
    'You should not respond to this context unless it is highly relevant to your task.\n' +
    '</system-reminder>\n'

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

export function buildLocalCommandInjectedBlocks(rec: LocalCommandRecord): PromptBlock[] {
  return [
    {
      type: 'text',
      text:
        'Caveat: The messages below were generated by the user while running local commands. ' +
        'DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.',
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        `<command-name>${rec.commandName}</command-name>\n` +
        `            <command-message>${rec.commandMessage}</command-message>\n` +
        `            <command-args>${rec.commandArgs}</command-args>`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `<local-command-stdout>${rec.stdout}</local-command-stdout>`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

export function buildBashModeInjectedBlocks(args: {
  input: string
  stdout: string
  stderr: string
}): PromptBlock[] {
  const input = escapeTagText(String(args.input ?? '').trim())
  const stdout = escapeTagText(truncateWithMarker(String(args.stdout ?? ''), MAX_BASH_MODE_OUTPUT_CHARS))
  const stderr = escapeTagText(truncateWithMarker(String(args.stderr ?? ''), MAX_BASH_MODE_OUTPUT_CHARS))

  return [
    {
      type: 'text',
      text:
        'Caveat: The messages below were generated by the user while running local commands. ' +
        'DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.',
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        `<bash-input>${input}</bash-input>\n` +
        `<bash-stdout>${stdout}</bash-stdout>\n` +
        `<bash-stderr>${stderr}</bash-stderr>`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function escapeTagText(text: string): string {
  // These injected blocks use XML-ish wrapper tags. Escape to avoid accidental tag breaks
  // when command output contains sequences like `</bash-stdout>`.
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
