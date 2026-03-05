import type { ToolCall, ToolResult } from '../types'
import type { StreamSink } from '../../streaming/types'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso, type TraceContext } from '../../core/audit/schema.js'
import { SUBAGENT_DENY_TOOLS_SET } from './subagentDenyTools'
import type { HooksRuntime } from '../../hooks/runtime.js'
import { appendHookRunAuditEvents } from '../../hooks/audit.js'
import type { HookRun } from '../../hooks/types.js'

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

  // Optional hooks runtime (Claude Code-style hooks)
  hooks?: HooksRuntime

  // Optional trace context for audit/event correlation.
  trace?: TraceContext

  // Optional session key for deferred tool exposure (ToolSearch).
  toolExposureSessionKey?: string
}

export interface ToolHandler {
  canHandle(name: string): boolean
  execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult>
}

export type ToolExecutor = (call: ToolCall, ctx: ExecutionContext) => Promise<ToolResult>
export type ToolPreflight = (call: ToolCall, ctx: ExecutionContext) => Promise<ToolResult | null>

// Sub-agents must not use interactive/session-affecting tools. They cannot reliably
// coordinate user input and should not mutate the parent session state.

type ExecutorStepState = {
  call: ToolCall
  ctx: ExecutionContext
  handler: ToolHandler | null
}

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
    hooks: ctx.hooks,
    trace: ctx.trace,
    toolExposureSessionKey: ctx.toolExposureSessionKey,
  }
}

function stepAbortIfSignalAborted(state: ExecutorStepState): ToolResult | null {
  if (!state.ctx.signal?.aborted) return null
  return { tool_use_id: state.call.id, content: 'Error: Request aborted', is_error: true }
}

function stepDenySubagentTools(state: ExecutorStepState): ToolResult | null {
  if (!(state.ctx.agentDepth > 0)) return null
  if (!SUBAGENT_DENY_TOOLS_SET.has(state.call.name)) return null
  return {
    tool_use_id: state.call.id,
    content: `Error: Tool not available: ${state.call.name}`,
    is_error: true,
  }
}

function stepAllowDenyLists(state: ExecutorStepState): ToolResult | null {
  const allowAll = state.ctx.allowTools?.includes('*') ?? false
  if (state.ctx.allowTools && !allowAll && !state.ctx.allowTools.includes(state.call.name)) {
    return {
      tool_use_id: state.call.id,
      content: `Error: Tool not allowed: ${state.call.name}`,
      is_error: true,
    }
  }

  if (state.ctx.denyTools && state.ctx.denyTools.includes(state.call.name)) {
    return {
      tool_use_id: state.call.id,
      content: `Error: Tool not allowed: ${state.call.name}`,
      is_error: true,
    }
  }

  return null
}

function stepResolveHandler(state: ExecutorStepState, handlers: ToolHandler[]): ToolResult | null {
  const handler = handlers.find((h) => h.canHandle(state.call.name)) ?? null
  state.handler = handler
  if (handler) return null
  return {
    tool_use_id: state.call.id,
    content: `Error: Tool not implemented: ${state.call.name}`,
    is_error: true,
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
    const baseTrace = ctx.trace ?? {}
    const traceForCall: TraceContext = {
      ...baseTrace,
      toolUseId: call.id,
    }

    const auditStart = () => {
      if (!audit) return
      void audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'tool.start',
        agentDepth: ctx.agentDepth,
        trace: traceForCall,
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
        trace: traceForCall,
        tool: { name: call.name, toolUseId: call.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        isError,
      })
    }

    const finish = (res: ToolResult): ToolResult => {
      auditEnd(Boolean(res.is_error))
      return res
    }

    const auditHookRuns = (eventName: string, runs: HookRun[]) => {
      appendHookRunAuditEvents({
        audit,
        tool: { name: call.name, toolUseId: call.id },
        agentDepth: ctx.agentDepth,
        eventName,
        runs,
        trace: traceForCall,
      })
    }

    auditStart()

    const state: ExecutorStepState = { call, ctx, handler: null }
    const early =
      stepAbortIfSignalAborted(state) ??
      stepDenySubagentTools(state) ??
      stepAllowDenyLists(state) ??
      stepResolveHandler(state, handlers)
    if (early) return finish(early)
    const handler = state.handler!

    try {
      if (ctx.hooks) {
        const pre = await ctx.hooks.runPreToolUse({
          toolName: call.name,
          toolInput: call.input ?? {},
          cwd: ctx.cwd,
          signal: ctx.signal,
        })
        auditHookRuns('PreToolUse', pre.runs)
        if (pre.blocked) {
          const stderr = pre.blockedBy?.stderr?.trim()
          const content = stderr ? `Error: Tool blocked by PreToolUse hook\n${stderr}` : 'Error: Tool blocked by PreToolUse hook'
          return finish({ tool_use_id: call.id, content, is_error: true })
        }
      }

      if (opts.preflight) {
        const res = await opts.preflight(call, ctx)
        if (res) {
          return finish(res)
        }
      }
      return finish(await handler.execute(call, ctx))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return finish({
        tool_use_id: call.id,
        content: msg,
        is_error: true,
      })
    }
  }
}
