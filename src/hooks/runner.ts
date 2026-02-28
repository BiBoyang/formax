import { spawn } from 'node:child_process'

import type { HookExecResult, HookRuleEntry, HookRun } from './types.js'

const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 60000
const MAX_OUTPUT_CHARS = 30000
const TRUNCATION_SUFFIX = '\n…(truncated)'

function appendLimited(prev: string, nextChunk: string): { next: string; truncated: boolean } {
  const combined = prev + nextChunk
  if (combined.length <= MAX_OUTPUT_CHARS) return { next: combined, truncated: false }
  return { next: combined.slice(combined.length - MAX_OUTPUT_CHARS), truncated: true }
}

function finalizeOutput(text: string, truncated: boolean): string {
  if (!truncated) return text
  if (text.endsWith(TRUNCATION_SUFFIX)) return text
  return `${text}${TRUNCATION_SUFFIX}`
}

function tryParseJson(text: string): unknown | null {
  const trimmed = String(text).trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

async function runSingleCommandHook(args: {
  source?: HookRuleEntry['source']
  matcher?: HookRuleEntry['matcher']
  command: string
  payload: unknown
  cwd: string
  env: Record<string, string | undefined>
  timeoutMs: number
  signal?: AbortSignal
}): Promise<HookRun> {
  const startedAt = Date.now()
  let stdout = ''
  let stderr = ''
  let stdoutTruncated = false
  let stderrTruncated = false
  let timedOut = false
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null

  const child = spawn(args.command, {
    cwd: args.cwd,
    env: args.env as any,
    shell: true,
    windowsHide: true,
  })

  const kill = () => {
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  if (args.signal?.aborted) {
    kill()
    return {
      source: args.source,
      matcher: args.matcher,
      timeoutMs: args.timeoutMs,
      command: args.command,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: 'aborted',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 0,
      timedOut: false,
      parsedJson: null,
    }
  }

  const onAbort = () => kill()
  args.signal?.addEventListener('abort', onAbort, { once: true })

  const timer =
    Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          kill()
        }, args.timeoutMs)
      : null

  child.stdout?.on('data', (buf: Buffer) => {
    const appended = appendLimited(stdout, buf.toString('utf8'))
    stdout = appended.next
    stdoutTruncated = stdoutTruncated || appended.truncated
  })
  child.stderr?.on('data', (buf: Buffer) => {
    const appended = appendLimited(stderr, buf.toString('utf8'))
    stderr = appended.next
    stderrTruncated = stderrTruncated || appended.truncated
  })

  try {
    child.stdin?.write(JSON.stringify(args.payload))
    child.stdin?.end()
  } catch {
    // ignore stdin write failures
  }

  await new Promise<void>((resolve) => {
    child.on('close', (code, signal) => {
      exitCode = typeof code === 'number' ? code : null
      exitSignal = signal ?? null
      resolve()
    })
    child.on('error', () => resolve())
  })

  if (timer) clearTimeout(timer)
  args.signal?.removeEventListener('abort', onAbort)

  const durationMs = Math.max(0, Date.now() - startedAt)
  const normalizedStdout = finalizeOutput(stdout, stdoutTruncated)
  const normalizedStderr = finalizeOutput(stderr, stderrTruncated)
  const parsedJson = exitCode === 0 ? tryParseJson(normalizedStdout) : null

  return {
    source: args.source,
    matcher: args.matcher,
    timeoutMs: args.timeoutMs,
    command: args.command,
    exitCode,
    signal: exitSignal,
    stdout: normalizedStdout,
    stderr: normalizedStderr,
    stdoutTruncated,
    stderrTruncated,
    durationMs,
    timedOut,
    parsedJson,
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let nextIndex = 0
  const limit = Math.max(1, Math.min(concurrency, items.length))

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= items.length) return
        out[index] = await fn(items[index], index)
      }
    }),
  )

  return out
}

export async function runCommandHooks(args: {
  hooks: HookRuleEntry[]
  payload: unknown
  cwd: string
  env: Record<string, string | undefined>
  concurrency?: number
  defaultTimeoutMs?: number
  signal?: AbortSignal
}): Promise<HookRun[]> {
  const concurrency = args.concurrency ?? DEFAULT_CONCURRENCY
  const defaultTimeoutMs = args.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

  return await runWithConcurrency(args.hooks, concurrency, async (entry) => {
    const timeoutMs = entry.timeoutMs ?? defaultTimeoutMs
    return await runSingleCommandHook({
      source: entry.source,
      matcher: entry.matcher,
      command: entry.command,
      payload: args.payload,
      cwd: args.cwd,
      env: args.env,
      timeoutMs,
      signal: args.signal,
    })
  })
}

export function summarizeHookRuns<T extends HookExecResult>(runs: T[]): {
  blocked: T[]
  failed: T[]
} {
  const blocked: T[] = []
  const failed: T[] = []

  for (const r of runs) {
    if (r.exitCode === 2) blocked.push(r)
    else if (r.exitCode !== 0) failed.push(r)
  }

  return { blocked, failed }
}
