import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRuntimeFlags, type RuntimeFlags } from '../../../env/runtimeFlags'
import type { CanonicalEvent } from '../../semantics/canonicalEvents'

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const MAX_OUTPUT_CHARS = 30000

function pickBashShell(args: { runtimeFlags: RuntimeFlags }): string | undefined {
  if (process.platform === 'win32') return undefined

  const candidates = [
    '/bin/bash',
    '/usr/bin/bash',
    args.runtimeFlags.userShellPath,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  for (const c of candidates) {
    try {
      if (existsSync(c)) return c
    } catch {
      // ignore
    }
  }
  return undefined
}

export type BashModeRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  exitSignal: string | null
  timedOut: boolean
}

export function createLocalBashCanonicalEmitter(args: {
  threadId: string
  turnId: string
  toolUseId: string
  onCanonicalEvent: (event: CanonicalEvent) => void
  nextReplaySeq: () => number
  nowIso?: () => string
}): {
  emitUserMessage: (command: string) => void
  emitToolEvent: (args: { phase: 'start' | 'update' | 'end'; line?: string; summary?: string; isError?: boolean }) => void
  emitFooter: (status: 'completed' | 'failed' | 'interrupted', message?: string) => void
} {
  const nowIso = args.nowIso ?? (() => new Date().toISOString())

  return {
    emitUserMessage: (command: string) => {
      const replaySeq = args.nextReplaySeq()
      args.onCanonicalEvent({
        threadId: args.threadId,
        replaySeq,
        eventId: `${args.threadId}:${args.turnId}:user_message:${replaySeq}`,
        ts: nowIso(),
        source: 'ui',
        kind: 'user_message',
        turnId: args.turnId,
        text: `! ${command}`,
      })
    },
    emitToolEvent: (toolEventArgs) => {
      const replaySeq = args.nextReplaySeq()
      args.onCanonicalEvent({
        threadId: args.threadId,
        replaySeq,
        eventId: `${args.threadId}:${args.turnId}:tool_event:${replaySeq}`,
        ts: nowIso(),
        source: 'tool',
        kind: 'tool_event',
        turnId: args.turnId,
        toolUseId: args.toolUseId,
        phase: toolEventArgs.phase,
        toolName: 'LocalBash',
        ...(toolEventArgs.line ? { line: toolEventArgs.line } : {}),
        ...(toolEventArgs.summary ? { summary: toolEventArgs.summary } : {}),
        ...(toolEventArgs.isError ? { isError: true } : {}),
      })
    },
    emitFooter: (status, message) => {
      const replaySeq = args.nextReplaySeq()
      args.onCanonicalEvent({
        threadId: args.threadId,
        replaySeq,
        eventId: `${args.threadId}:${args.turnId}:turn_footer:${replaySeq}`,
        ts: nowIso(),
        source: 'ui',
        kind: 'turn_footer',
        turnId: args.turnId,
        status,
        ...(message ? { message } : {}),
      })
    },
  }
}

export async function runBashModeCommand(args: {
  command: string
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  runtimeFlags?: RuntimeFlags
}): Promise<BashModeRunResult> {
  const cmd = String(args.command ?? '')
  const cwd = args.cwd
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runtimeEnv = args.env ?? process.env
  const runtimeFlags = args.runtimeFlags ?? createRuntimeFlags(runtimeEnv)

  return await new Promise((resolve) => {
    exec(
      cmd,
      {
        cwd,
        env: { ...runtimeEnv },
        // Match the user-visible semantics of "bash mode": run under bash when available.
        shell: pickBashShell({ runtimeFlags }),
        timeout: timeoutMs,
        // Keep high, but we also clamp below.
        maxBuffer: 10 * 1024 * 1024,
        signal: args.signal as any,
      },
      (err, stdoutRaw, stderrRaw) => {
        const stdout = appendLimited('', sanitizeShellText(stdoutRaw))
        const stderr = appendLimited('', sanitizeShellText(stderrRaw))

        if (!err) {
          resolve({ stdout, stderr, exitCode: 0, exitSignal: null, timedOut: false })
          return
        }

        const code = (err as any)?.code as unknown
        const exitSignal = (err as any)?.signal as unknown
        const killed = Boolean((err as any)?.killed)
        const aborted = Boolean(args.signal?.aborted)

        const timedOut =
          !aborted &&
          (code === 'ETIMEDOUT' || (killed && typeof exitSignal === 'string' && exitSignal === 'SIGTERM'))

        resolve({
          stdout,
          stderr,
          exitCode: typeof code === 'number' ? code : null,
          exitSignal: typeof exitSignal === 'string' ? exitSignal : null,
          timedOut,
        })
      },
    )
  })
}

export function formatBashModeOutput(args: {
  stdout: string
  stderr: string
  timedOut?: boolean
  exitCode?: number | null
  exitSignal?: string | null
}): string {
  const out = args.stdout || ''
  const err = args.stderr || ''

  const headline = (() => {
    if (args.timedOut) return 'Timed out'
    if (args.exitSignal) return `Exit signal ${args.exitSignal}`
    if (typeof args.exitCode === 'number' && args.exitCode !== 0) return `Exit code ${args.exitCode}`
    return null
  })()

  const body = (() => {
    if (!err.trim()) return out || '(no output)'
    if (!out.trim()) return `stderr:\n${err}`
    return `stderr:\n${err}\nstdout:\n${out}`
  })()

  if (!headline) return body
  if (!body.trim()) return `Error: ${headline}`
  return `Error: ${headline}\n${body}`
}

function sanitizeShellText(text: string): string {
  const raw = String(text || '')
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const noCsi = normalized.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  const noOsc = noCsi.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
  return noOsc.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

function appendLimited(prev: string, nextChunk: string): string {
  const next = (prev || '') + (nextChunk || '')
  if (next.length <= MAX_OUTPUT_CHARS) return next
  return next.slice(next.length - MAX_OUTPUT_CHARS)
}
