import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { PromptBlock } from '../../prompts'
import type { LocalCommandRecord } from '../commands/registry'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'

const MAX_CLAUDE_MD_CHARS = 200_000

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
}

function truncateWithMarker(input: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (input.length <= maxChars) return input
  if (maxChars <= TRUNCATED_MARKER.length) return TRUNCATED_MARKER.slice(0, maxChars)
  return input.slice(0, maxChars - TRUNCATED_MARKER.length) + TRUNCATED_MARKER
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
}): ClaudeMdInjectionMeta {
  const { global, project } = readAndCapClaudeMd(args)

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

  return {
    capChars: MAX_CLAUDE_MD_CHARS,
    global: toMeta(global),
    project: toMeta(project),
  }
}

export function buildClaudeMdInjectedBlocks(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): PromptBlock[] {
  const { global, project } = readAndCapClaudeMd(args)
  if (!global && !project) return []

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
