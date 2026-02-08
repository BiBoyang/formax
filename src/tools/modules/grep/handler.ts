import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { resolveRipgrepExecutable } from './ripgrepBinary'

type GrepOutputMode = 'content' | 'files_with_matches' | 'count'
type CommandResult = { exitCode: number; stdout: string; stderr: string }

const DEFAULT_HEAD_LIMIT = 0

type GrepHandlerDeps = {
  resolveExecutable: () => Promise<string>
  runCommand: (command: string, args: string[], opts: { cwd: string }) => Promise<CommandResult>
}

const DEFAULT_DEPS: GrepHandlerDeps = {
  resolveExecutable: resolveRipgrepExecutable,
  runCommand: runCommandWithSpawn,
}

export function createGrepToolHandler(
  overrides: Partial<GrepHandlerDeps> = {},
): ToolHandler {
  const deps = { ...DEFAULT_DEPS, ...overrides }

  return {
    canHandle(name: string): boolean {
      return name === 'Grep'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'Grep.input')
        assertNoExtraKeys(
          input,
          [
            'pattern',
            'path',
            'glob',
            'output_mode',
            '-B',
            '-A',
            '-C',
            '-n',
            '-i',
            'type',
            'head_limit',
            'offset',
            'multiline',
          ],
          'Grep.input',
        )

        const cwd = ctx.cwd || process.cwd()
        const pattern = (input as any).pattern
        if (!pattern) throw new Error('Missing pattern')

        const searchPathRaw = (input as any).path || cwd
        const searchPath = path.isAbsolute(searchPathRaw)
          ? searchPathRaw
          : path.resolve(cwd, searchPathRaw)

        const outputMode: GrepOutputMode =
          (input as any).output_mode === 'content' || (input as any).output_mode === 'count'
            ? (input as any).output_mode
            : 'files_with_matches'

        const headLimitRaw = (input as any).head_limit
        const offsetRaw = (input as any).offset
        const headLimit =
          headLimitRaw === undefined || headLimitRaw === null || headLimitRaw === ''
            ? DEFAULT_HEAD_LIMIT
            : parseNonNegativeInt(headLimitRaw)
        const offset = parseNonNegativeInt(offsetRaw)

        const command = await deps.resolveExecutable()
        const args = buildRgArgs({ input, outputMode, pattern: String(pattern), searchPath })
        const result = await deps.runCommand(command, args, { cwd })

        if (result.exitCode === 1) {
          return { tool_use_id: call.id, content: 'No matches found' }
        }

        const rawLines = normalizeOutputLines(result.stdout)

        if (result.exitCode !== 0 && result.exitCode !== 2) {
          throw new Error(`ripgrep failed (${result.exitCode}): ${compactErrorText(result.stderr)}`)
        }

        if (result.exitCode === 2 && rawLines.length === 0) {
          throw new Error(`ripgrep failed: ${compactErrorText(result.stderr)}`)
        }

        const lines = applyOffsetHead(rawLines, { offset, headLimit })
        const content = lines.length ? lines.join('\n') : 'No matches found'
        return { tool_use_id: call.id, content }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

export const GrepToolHandler: ToolHandler = createGrepToolHandler()

type BuildArgs = {
  input: Record<string, unknown>
  outputMode: GrepOutputMode
  pattern: string
  searchPath: string
}

function buildRgArgs(args: BuildArgs): string[] {
  const rgArgs: string[] = [
    '--color',
    'never',
    '--hidden',
    '--follow',
    '--no-messages',
    '--glob',
    '!.git/**',
    '--glob',
    '!node_modules/**',
  ]

  if (args.outputMode === 'files_with_matches') {
    rgArgs.push('--files-with-matches')
  } else if (args.outputMode === 'count') {
    rgArgs.push('--count')
  } else {
    const showLineNumbers = args.input['-n'] !== false
    if (showLineNumbers) rgArgs.push('--line-number')

    const before = parseNonNegativeInt(args.input['-C'] ?? args.input['-B'])
    const after = parseNonNegativeInt(args.input['-C'] ?? args.input['-A'])
    if (before > 0) rgArgs.push('--before-context', String(before))
    if (after > 0) rgArgs.push('--after-context', String(after))
  }

  if (Boolean(args.input['-i'])) {
    rgArgs.push('--ignore-case')
  }

  const typeFilter = typeof args.input.type === 'string' ? args.input.type.trim() : ''
  if (typeFilter) {
    rgArgs.push('--type', typeFilter)
  }

  if (Boolean(args.input.multiline)) {
    rgArgs.push('--multiline', '--multiline-dotall')
  }

  const glob = typeof args.input.glob === 'string' ? args.input.glob.trim() : ''
  if (glob) {
    rgArgs.push('--glob', glob)
  }

  rgArgs.push('--with-filename')
  rgArgs.push('--regexp', args.pattern)
  rgArgs.push('--', args.searchPath)
  return rgArgs
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

function parseNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n))
  }
  return 0
}

function applyOffsetHead(lines: string[], args: { offset: number; headLimit: number }): string[] {
  const off = args.offset > 0 ? args.offset : 0
  const afterOffset = off > 0 ? lines.slice(off) : lines
  const head = args.headLimit > 0 ? args.headLimit : 0
  return head > 0 ? afterOffset.slice(0, head) : afterOffset
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
