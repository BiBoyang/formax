import type { ToolCall, ToolResult } from '../types'
import type { StreamSink } from '../../streaming/types'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso } from '../../core/audit/schema.js'
import { SUBAGENT_DENY_TOOLS_SET } from './subagentDenyTools'

export type ReplMode = 'normal' | 'acceptEdits' | 'plan'

export type ExecutionContext = {
  cwd: string
  signal?: AbortSignal
  onEvent?: StreamSink

  // Whether the current tool execution context is allowed to prompt the user
  // (e.g. approvals). Background tasks may disable this to avoid deadlocks.
  interactive?: boolean

  // 0 = main agent, 1 = sub-agent, ...
  agentDepth: number

  // Optional UI mode for policy decisions (e.g., plan mode restrictions)
  replMode?: ReplMode
  getReplMode?: () => ReplMode | undefined
  setReplMode?: (mode: ReplMode) => void

  // Optional plan file context (Claude Code-style plan mode)
  getPlanPath?: () => string | null
  planPath?: string | null

  // Optional allow/deny lists for executor-level enforcement
  allowTools?: string[]
  denyTools?: string[]
}

export interface ToolHandler {
  canHandle(name: string): boolean
  execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult>
}

export type ToolExecutor = (call: ToolCall, ctx: ExecutionContext) => Promise<ToolResult>
export type ToolPreflight = (call: ToolCall, ctx: ExecutionContext) => Promise<ToolResult | null>

// Sub-agents must not use interactive/session-affecting tools. They cannot reliably
// coordinate user input and should not mutate the parent session state.

function normalizeCtx(ctx: Partial<ExecutionContext>): ExecutionContext {
  return {
    cwd: ctx.cwd ?? process.cwd(),
    signal: ctx.signal,
    onEvent: ctx.onEvent,
    interactive: ctx.interactive,
    agentDepth: ctx.agentDepth ?? 0,
    replMode: ctx.replMode,
    getReplMode: ctx.getReplMode,
    setReplMode: ctx.setReplMode,
    getPlanPath: ctx.getPlanPath,
    planPath: ctx.planPath,
    allowTools: ctx.allowTools,
    denyTools: ctx.denyTools,
  }
}

export function createToolExecutor(
  handlers: ToolHandler[],
  opts: { preflight?: ToolPreflight; audit?: AuditLog } = {},
): ToolExecutor {
  return async (call, ctxPartial) => {
    const ctx = normalizeCtx(ctxPartial)
    const startedAt = Date.now()
    const audit = opts.audit

    const auditStart = () => {
      if (!audit) return
      void audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'tool.start',
        agentDepth: ctx.agentDepth,
        tool: { name: call.name, toolUseId: call.id },
      })
    }
    const auditEnd = (isError: boolean) => {
      if (!audit) return
      void audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'tool.end',
        agentDepth: ctx.agentDepth,
        tool: { name: call.name, toolUseId: call.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        isError,
      })
    }

    auditStart()

    if (ctx.signal?.aborted) {
      const res = { tool_use_id: call.id, content: 'Error: Request aborted', is_error: true }
      auditEnd(true)
      return res
    }

    if (ctx.agentDepth > 0 && SUBAGENT_DENY_TOOLS_SET.has(call.name)) {
      const res = {
        tool_use_id: call.id,
        content: `Error: Tool not available: ${call.name}`,
        is_error: true,
      }
      auditEnd(true)
      return res
    }

    const allowAll = ctx.allowTools?.includes('*') ?? false
    if (ctx.allowTools && !allowAll && !ctx.allowTools.includes(call.name)) {
      const res = {
        tool_use_id: call.id,
        content: `Error: Tool not allowed: ${call.name}`,
        is_error: true,
      }
      auditEnd(true)
      return res
    }

    if (ctx.denyTools && ctx.denyTools.includes(call.name)) {
      const res = {
        tool_use_id: call.id,
        content: `Error: Tool not allowed: ${call.name}`,
        is_error: true,
      }
      auditEnd(true)
      return res
    }

    const handler = handlers.find((h) => h.canHandle(call.name))
    if (!handler) {
      const res = {
        tool_use_id: call.id,
        content: `Error: Tool not implemented: ${call.name}`,
        is_error: true,
      }
      auditEnd(true)
      return res
    }

    try {
      if (opts.preflight) {
        const res = await opts.preflight(call, ctx)
        if (res) {
          auditEnd(Boolean(res.is_error))
          return res
        }
      }
      const res = await handler.execute(call, ctx)
      auditEnd(Boolean(res.is_error))
      return res
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const res = {
        tool_use_id: call.id,
        content: msg,
        is_error: true,
      }
      auditEnd(true)
      return res
    }
  }
}
