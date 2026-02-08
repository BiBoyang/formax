import path from 'node:path'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { resolveRipgrepExecutable } from '../grep/ripgrepBinary'

type CommandResult = { exitCode: number; stdout: string; stderr: string }
type StatLike = { isDirectory: () => boolean; mtimeMs?: number }

type GlobHandlerDeps = {
  resolveExecutable: () => Promise<string>
  runCommand: (command: string, args: string[], opts: { cwd: string }) => Promise<CommandResult>
  statPath: (filePath: string) => Promise<StatLike>
}

const DEFAULT_DEPS: GlobHandlerDeps = {
  resolveExecutable: resolveRipgrepExecutable,
  runCommand: runCommandWithSpawn,
  statPath: async (filePath: string) => await fsp.stat(filePath),
}

export function createGlobToolHandler(overrides: Partial<GlobHandlerDeps> = {}): ToolHandler {
  const deps = { ...DEFAULT_DEPS, ...overrides }

  return {
    canHandle(name: string): boolean {
      return name === 'Glob'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'Glob.input')
        assertNoExtraKeys(input, ['pattern', 'path'], 'Glob.input')
        const cwd = ctx.cwd || process.cwd()

        const pattern = (input as any).pattern
        const rootRaw = (input as any).path || cwd
        if (!pattern) throw new Error('Missing pattern')
        const root = path.isAbsolute(rootRaw) ? rootRaw : path.resolve(cwd, rootRaw)
        const rootStat = await deps.statPath(root)
        if (!rootStat.isDirectory()) {
          throw new Error(`path must be a directory: ${root}`)
        }

        const command = await deps.resolveExecutable()
        const args = buildRgArgs(String(pattern))
        const result = await deps.runCommand(command, args, { cwd: root })

        const lines = normalizeOutputLines(result.stdout).map((line) =>
          path.isAbsolute(line) ? line : path.resolve(root, line),
        )

        if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
          throw new Error(`ripgrep failed (${result.exitCode}): ${compactErrorText(result.stderr)}`)
        }

        if (result.exitCode === 2 && !lines.length) {
          throw new Error(`ripgrep failed: ${compactErrorText(result.stderr)}`)
        }

        if (!lines.length) {
          return { tool_use_id: call.id, content: 'No files found' }
        }

        const withTimes = await Promise.all(lines.map(async (filePath) => {
          let mtimeMs = 0
          try {
            const st = await deps.statPath(filePath)
            if (typeof st.mtimeMs === 'number' && Number.isFinite(st.mtimeMs)) {
              mtimeMs = st.mtimeMs
            }
          } catch {
            mtimeMs = 0
          }
          return { filePath, mtimeMs }
        }))

        withTimes.sort((a, b) => {
          if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
          return a.filePath.localeCompare(b.filePath)
        })

        const sorted = withTimes.map((entry) => entry.filePath)
        const content = sorted.length ? sorted.join('\n') : 'No files found'
        return { tool_use_id: call.id, content }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

export const GlobToolHandler: ToolHandler = createGlobToolHandler()

function buildRgArgs(pattern: string): string[] {
  return [
    '--files',
    '--hidden',
    '--color',
    'never',
    '--no-messages',
    '--glob',
    '!.git/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    pattern,
    '.',
  ]
}

async function runCommandWithSpawn(
  command: string,
  args: string[],
  opts: { cwd: string },
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8')
    })

    child.on('error', (err) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: err.message || stderr || `Failed to execute ${command}`,
      })
    })
    child.on('close', (code) => {
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        stdout,
        stderr,
      })
    })
  })
}

function normalizeOutputLines(output: string): string[] {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
}

function compactErrorText(stderr: string): string {
  const cleaned = String(stderr || '').replace(/\s+/g, ' ').trim()
  return cleaned || 'unknown error'
}
