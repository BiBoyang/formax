import type { AuditLog } from '../adapters/audit/auditLog.js'
import { nowIso, type TraceContext } from '../core/audit/schema.js'
import type { HookRun } from './types.js'

function isHooksDebugEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env.FORMAX_HOOKS_DEBUG ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function preview(raw: unknown, limit = 2000): string | undefined {
  const s = String(raw ?? '').trimEnd()
  if (!s) return undefined
  return s.length <= limit ? s : s.slice(s.length - limit)
}

function statusFrom(run: HookRun): 'ok' | 'blocked' | 'failed' | 'aborted' {
  if (run.exitCode === 0) return 'ok'
  if (run.exitCode === 2) return 'blocked'
  if (run.exitCode === null && String(run.stderr || '').trim().toLowerCase() === 'aborted') return 'aborted'
  return 'failed'
}

export function appendHookRunAuditEvents(args: {
  audit: AuditLog | null | undefined
  tool: { name: string; toolUseId: string }
  agentDepth: number
  eventName: string
  runs: HookRun[]
  trace?: TraceContext
  env?: NodeJS.ProcessEnv
  hooksDebugEnabled?: boolean
  previewLimit?: number
}): void {
  const audit = args.audit
  if (!audit) return
  if (args.runs.length === 0) return

  const env = args.env ?? process.env
  const limit = args.previewLimit ?? 2000
  const debugEnabled = args.hooksDebugEnabled ?? isHooksDebugEnabled(env)

  for (const run of args.runs) {
    const status = statusFrom(run)
    const stderrPreview = status === 'ok' ? undefined : preview(run.stderr, limit)
    const stdoutPreview = debugEnabled ? preview(run.stdout, limit) : undefined

    void audit.append({
      schemaVersion: 1,
      ts: nowIso(),
      kind: 'hook.run',
      agentDepth: args.agentDepth,
      ...(args.trace ? { trace: args.trace } : {}),
      tool: args.tool,
      hook: {
        eventName: args.eventName,
        ...(run.source ? { source: run.source } : {}),
        ...(typeof run.matcher === 'string' ? { matcher: run.matcher } : {}),
        command: run.command,
        ...(typeof run.timeoutMs === 'number' || run.timeoutMs === null ? { timeoutMs: run.timeoutMs } : {}),
        exitCode: run.exitCode,
        signal: run.signal,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        status,
        parsedJson: run.parsedJson !== null,
        ...(stdoutPreview ? { stdoutPreview } : {}),
        ...(stderrPreview ? { stderrPreview } : {}),
        ...(typeof run.stdoutTruncated === 'boolean' ? { stdoutTruncated: run.stdoutTruncated } : {}),
        ...(typeof run.stderrTruncated === 'boolean' ? { stderrTruncated: run.stderrTruncated } : {}),
      },
    })
  }
}
