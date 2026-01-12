import type { ToolCall, ToolResult } from '../types'
import type { StreamSink } from '../../streaming/types'

export type ReplMode = 'normal' | 'acceptEdits' | 'plan'

export type ExecutionContext = {
  cwd: string
  signal?: AbortSignal
  onEvent?: StreamSink

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

const NESTED_DENY_TOOLS = new Set(['Task', 'Agent', 'Dispatch', 'SlashCommand'])

function normalizeCtx(ctx: Partial<ExecutionContext>): ExecutionContext {
  return {
    cwd: ctx.cwd ?? process.cwd(),
    signal: ctx.signal,
    onEvent: ctx.onEvent,
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

export function createToolExecutor(handlers: ToolHandler[], opts: { preflight?: ToolPreflight } = {}): ToolExecutor {
  return async (call, ctxPartial) => {
    const ctx = normalizeCtx(ctxPartial)

    if (ctx.signal?.aborted) {
      return { tool_use_id: call.id, content: 'Request aborted', is_error: true }
    }

    if (ctx.agentDepth > 0 && NESTED_DENY_TOOLS.has(call.name)) {
      return {
        tool_use_id: call.id,
        content: `Tool ${call.name} is not allowed inside a sub-agent`,
        is_error: true,
      }
    }

    const allowAll = ctx.allowTools?.includes('*') ?? false
    if (ctx.allowTools && !allowAll && !ctx.allowTools.includes(call.name)) {
      return {
        tool_use_id: call.id,
        content: `Tool ${call.name} is not in allow-list`,
        is_error: true,
      }
    }

    if (ctx.denyTools && ctx.denyTools.includes(call.name)) {
      return {
        tool_use_id: call.id,
        content: `Tool ${call.name} is in deny-list`,
        is_error: true,
      }
    }

    const handler = handlers.find((h) => h.canHandle(call.name))
    if (!handler) {
      return {
        tool_use_id: call.id,
        content: `Tool ${call.name} not implemented`,
        is_error: true,
      }
    }

    try {
      if (opts.preflight) {
        const res = await opts.preflight(call, ctx)
        if (res) return res
      }
      return await handler.execute(call, ctx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        tool_use_id: call.id,
        content: msg,
        is_error: true,
      }
    }
  }
}
