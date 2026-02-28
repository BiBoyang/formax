import { exec, spawn } from 'node:child_process'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { ManagedTaskResult, ManagedTaskRunContext, TaskManager } from '../../runtime/taskManager'
import { classifyBashCommand } from './policy'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

// Default is intentionally generous: many real-world commands (tests, reviews) can
// take minutes, and users can always interrupt from the UI.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const MAX_TIMEOUT_MS = 20 * 60 * 1000
const MAX_OUTPUT_CHARS = 30000

export function createBashToolHandler(deps: { taskManager: TaskManager }): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Bash'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'Bash.input')
        assertNoExtraKeys(
          input,
          ['command', 'timeout', 'description', 'run_in_background', 'dangerouslyDisableSandbox'],
          'Bash.input',
        )
        const cwd = ctx.cwd || process.cwd()

        const cmd = (input as any).command
        const timeoutMs =
          (input as any).timeout === undefined
            ? DEFAULT_TIMEOUT_MS
            : assertTimeout((input as any).timeout)
        const runInBackground = Boolean((input as any).run_in_background)
        const description = typeof (input as any).description === 'string' ? (input as any).description.trim() : ''
        const dangerouslyDisableSandbox = Boolean((input as any).dangerouslyDisableSandbox)

        if (!cmd) throw new Error('Missing command')

        const cmdCwd = cwd
        const cmdStr = String(cmd)

        let decision = classifyBashCommand({
          command: cmdStr,
          mode: ctx.getReplMode?.() ?? ctx.replMode,
          agentDepth: ctx.agentDepth,
        })

        if (decision.risk !== 'deny' && dangerouslyDisableSandbox) {
          decision = {
            ...decision,
            risk: 'confirm',
            reason: 'dangerouslyDisableSandbox requested',
            matchedRule: 'confirm_disable_sandbox',
          }
        }

        if (decision.risk === 'deny') {
          return {
            tool_use_id: call.id,
            content: `Error: Bash command denied (${decision.prefix}): ${decision.reason}`,
            is_error: true,
          }
        }

        const env = { ...process.env }

        if (!runInBackground) {
          const { content, isError } = await runForeground({ cmd: cmdStr, cmdCwd, env, timeoutMs, signal: ctx.signal })
          return { tool_use_id: call.id, content, ...(isError ? { is_error: true } : {}) }
        }

        const label = description || truncateCommand(cmdStr, 80)
        const taskId = deps.taskManager.create({
          kind: 'shell',
          label,
          run: (taskCtx) => runBackground({ taskCtx, cmd: cmdStr, cmdCwd, env, timeoutMs }),
        })

        return {
          tool_use_id: call.id,
          content: JSON.stringify({ task_id: taskId, shell_id: taskId, status: 'running' }, null, 2),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

async function runForeground(args: {
  cmd: string
  cmdCwd: string
  env: Record<string, string | undefined>
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{ content: string; isError: boolean }> {
  return await new Promise((resolve) => {
    exec(
      args.cmd,
      {
        cwd: args.cmdCwd,
        env: args.env,
        timeout: args.timeoutMs,
        // We truncate the final tool output ourselves, but `exec` still needs a higher
        // ceiling to avoid "maxBuffer length exceeded" on verbose commands.
        maxBuffer: 10 * 1024 * 1024,
        signal: args.signal as any,
      },
      (err, stdout, stderr) => {
        const content = formatShellOutput(
          appendLimited('', sanitizeShellText(stdout)),
          appendLimited('', sanitizeShellText(stderr)),
        )
        if (err) {
          const code = (err as any)?.code as unknown
          const signal = (err as any)?.signal as unknown
          const killed = Boolean((err as any)?.killed)
          const aborted = Boolean(args.signal?.aborted)
          const msg = err instanceof Error ? err.message : String(err)
          const isTimeout =
            !aborted && (code === 'ETIMEDOUT' || (killed && typeof signal === 'string' && signal === 'SIGTERM'))
          const headline =
            isTimeout
              ? `Timed out after ${args.timeoutMs}ms`
              : code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? 'Output exceeded exec maxBuffer'
                : typeof code === 'number'
                  ? `Exit code ${code}`
                  : typeof signal === 'string' && signal
                    ? `Exit signal ${signal}`
                    : msg
          resolve({ content: `Error: ${headline}\n${content}`, isError: true })
        } else {
          resolve({ content, isError: false })
        }
      },
    )
  })
}

async function runBackground(args: {
  taskCtx: ManagedTaskRunContext
  cmd: string
  cmdCwd: string
  env: Record<string, string | undefined>
  timeoutMs: number
}): Promise<ManagedTaskResult> {
  const { taskCtx } = args
  const { signal, setCancel, updateResult } = taskCtx

  let stdoutRaw = ''
  let stderrRaw = ''
  let timedOut = false

  const child = spawn(args.cmd, {
    cwd: args.cmdCwd,
    env: args.env as any,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })

  const kill = () => killProcessTree(child)
  setCancel(kill)

  if (signal.aborted) {
    kill()
    return { content: 'Killed', is_error: true }
  }

  const onAbort = () => kill()
  signal.addEventListener('abort', onAbort, { once: true })

  const scheduleUpdate = createThrottledUpdater(() => {
    updateResult({
      content: formatShellOutput(
        sanitizeShellText(stdoutRaw),
        sanitizeShellText(stderrRaw),
      ),
    })
  })

  child.stdout?.on('data', (buf: Buffer) => {
    stdoutRaw = appendLimited(stdoutRaw, buf.toString('utf8'))
    scheduleUpdate()
  })
  child.stderr?.on('data', (buf: Buffer) => {
    stderrRaw = appendLimited(stderrRaw, buf.toString('utf8'))
    scheduleUpdate()
  })

  const timer = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true
        kill()
      }, args.timeoutMs)
    : null

  return await new Promise<ManagedTaskResult>((resolve) => {
    let settled = false
    const finish = (result: ManagedTaskResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      scheduleUpdate.flush()
      resolve(result)
    }

    child.on('error', (err) => {
      finish({ content: `Error: ${err.message}`, is_error: true })
    })

    child.on('close', (code, exitSignal) => {
      const output = formatShellOutput(
        sanitizeShellText(stdoutRaw),
        sanitizeShellText(stderrRaw),
      )

      if (signal.aborted) {
        finish({ content: `Killed\n${output}`, is_error: true })
        return
      }

      if (timedOut) {
        finish({
          content: `Timed out after ${args.timeoutMs}ms\n${output}`,
          is_error: true,
        })
        return
      }

      if (exitSignal) {
        finish({
          content: `Exit signal ${exitSignal}\n${output}`,
          is_error: true,
        })
        return
      }

      if (typeof code === 'number' && code !== 0) {
        finish({ content: `Exit code ${code}\n${output}`, is_error: true })
        return
      }

      finish({ content: output })
    })
  })
}

function truncateCommand(cmd: string, max: number): string {
  const s = cmd.trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatShellOutput(stdout: string, stderr: string): string {
  const out = stdout || ''
  const err = stderr || ''

  if (!err.trim()) return out || '(no output)'
  if (!out.trim()) return `stderr:\n${err}`
  return `stderr:\n${err}\nstdout:\n${out}`
}

function sanitizeShellText(text: string): string {
  const raw = String(text || '')

  // Normalize carriage returns: many CLIs use `\r` for live-updating spinners/progress.
  // If we keep raw `\r` in the transcript, it can corrupt Ink/terminal layout.
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Strip common ANSI escape sequences (CSI + OSC), since we render via Ink components.
  // CSI: ESC [ ... finalByte
  const noCsi = normalized.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  // OSC: ESC ] ... BEL or ESC \
  const noOsc = noCsi.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')

  // Drop remaining control chars (except newline/tab).
  return noOsc.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

function appendLimited(prev: string, nextChunk: string): string {
  const next = (prev || '') + (nextChunk || '')
  if (next.length <= MAX_OUTPUT_CHARS) return next
  return next.slice(next.length - MAX_OUTPUT_CHARS)
}

function assertTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('timeout must be a number')
  }
  if (value < 0) throw new Error('timeout must be >= 0')
  if (value > MAX_TIMEOUT_MS) throw new Error(`timeout must be <= ${MAX_TIMEOUT_MS}`)
  return Math.floor(value)
}

function createThrottledUpdater(fn: () => void): (() => void) & { flush: () => void } {
  let pending = false
  let timer: NodeJS.Timeout | null = null

  const tick = () => {
    pending = false
    timer = null
    fn()
  }

  const schedule = () => {
    if (pending) return
    pending = true
    timer = setTimeout(tick, 100)
  }

  schedule.flush = () => {
    if (timer) clearTimeout(timer)
    pending = false
    timer = null
    fn()
  }

  return schedule
}

function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid
  if (!pid) return

  try {
    process.kill(-pid, 'SIGTERM')
    return
  } catch {
    // fall through
  }

  try {
    child.kill('SIGTERM')
  } catch {
    // ignore
  }
}
