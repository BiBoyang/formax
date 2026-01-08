import path from 'node:path'
import { exec, spawn } from 'node:child_process'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { ManagedTaskResult, ManagedTaskRunContext, TaskManager } from '../../runtime/taskManager'
import { classifyBashCommand } from './policy'

const DEFAULT_TIMEOUT_MS = 120000
const MAX_OUTPUT_CHARS = 30000

export function createBashToolHandler(deps: { taskManager: TaskManager }): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Bash'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = call.input || {}
        const cwd = ctx.cwd || process.cwd()

        const cmd = (input as any).command
        const confirmed = Boolean((input as any).confirm || (input as any).dangerouslyDisableSandbox === true)
        const timeoutMs =
          typeof (input as any).timeout === 'number' ? (input as any).timeout : DEFAULT_TIMEOUT_MS
        const runInBackground = Boolean((input as any).run_in_background)
        const description = typeof (input as any).description === 'string' ? (input as any).description.trim() : ''

        if (!cmd) throw new Error('Missing command')

        const decision = classifyBashCommand({
          command: String(cmd),
          mode: ctx.replMode,
          agentDepth: ctx.agentDepth,
        })

        if (decision.risk === 'deny') {
          return {
            tool_use_id: call.id,
            content: `Error: Bash command denied (${decision.prefix}): ${decision.reason}`,
            is_error: true,
          }
        }

        if (decision.risk === 'confirm' && !confirmed) {
          return {
            tool_use_id: call.id,
            content:
              `Error: Bash command requires confirmation (${decision.prefix}). ` +
              `${decision.reason}\n` +
              `Re-run this Bash call with {"confirm": true} to proceed.`,
            is_error: true,
          }
        }

        const cmdCwdRaw = (input as any).cwd || cwd
        const cmdCwd = path.isAbsolute(cmdCwdRaw) ? cmdCwdRaw : path.resolve(cwd, cmdCwdRaw)
        const env = { ...process.env, ...(((input as any).env as any) || {}) }

        if (!runInBackground) {
          const { content, isError } = await runForeground({ cmd: String(cmd), cmdCwd, env, timeoutMs, signal: ctx.signal })
          return { tool_use_id: call.id, content, ...(isError ? { is_error: true } : {}) }
        }

        const label = description || truncateCommand(String(cmd), 80)
        const taskId = deps.taskManager.create({
          kind: 'shell',
          label,
          run: (taskCtx) => runBackground({ taskCtx, cmd: String(cmd), cmdCwd, env, timeoutMs }),
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
        signal: args.signal as any,
      },
      (err, stdout, stderr) => {
        const content = formatShellOutput(stdout, stderr)
        if (err) {
          const msg = err instanceof Error ? err.message : String(err)
          resolve({ content: content ? `Error: ${msg}\n${content}` : `Error: ${msg}`, isError: true })
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

  let stdout = ''
  let stderr = ''
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
    updateResult({ content: formatShellOutput(stdout, stderr) })
  })

  child.stdout?.on('data', (buf: Buffer) => {
    stdout = appendLimited(stdout, buf.toString('utf8'))
    scheduleUpdate()
  })
  child.stderr?.on('data', (buf: Buffer) => {
    stderr = appendLimited(stderr, buf.toString('utf8'))
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
      const output = formatShellOutput(stdout, stderr)

      if (signal.aborted) {
        finish({ content: output ? `Killed\n${output}` : 'Killed', is_error: true })
        return
      }

      if (timedOut) {
        finish({
          content: output ? `Timed out after ${args.timeoutMs}ms\n${output}` : `Timed out after ${args.timeoutMs}ms`,
          is_error: true,
        })
        return
      }

      if (exitSignal) {
        finish({
          content: output ? `Exit signal ${exitSignal}\n${output}` : `Exit signal ${exitSignal}`,
          is_error: true,
        })
        return
      }

      if (typeof code === 'number' && code !== 0) {
        finish({ content: output ? `Exit code ${code}\n${output}` : `Exit code ${code}`, is_error: true })
        return
      }

      finish({ content: output || '(no output)' })
    })
  })
}

function truncateCommand(cmd: string, max: number): string {
  const s = (cmd || '').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatShellOutput(stdout: string, stderr: string): string {
  const out = stdout || ''
  const err = stderr || ''

  if (!err.trim()) return out || '(no output)'
  if (!out.trim()) return `stderr:\n${err}`
  return `stderr:\n${err}\nstdout:\n${out}`
}

function appendLimited(prev: string, nextChunk: string): string {
  const next = (prev || '') + (nextChunk || '')
  if (next.length <= MAX_OUTPUT_CHARS) return next
  return next.slice(next.length - MAX_OUTPUT_CHARS)
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

  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM')
      return
    } catch {
      // fall through
    }
  }

  try {
    child.kill('SIGTERM')
  } catch {
    // ignore
  }
}
