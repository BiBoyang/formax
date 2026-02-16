import type { StreamEvent, TokenUsage } from '../../../streaming/types'

export type ExploreTaskBatch = {
  toolUseIds: Set<string>
  completedToolUseIds: Set<string>
  lastSeenAtMs: number
}

type TaskToolStats = {
  startedAt: number
  toolUses: number
  usage?: TokenUsage
}

export function updateTaskStateFromToolInput(args: {
  toolUseId: string
  toolName: string | undefined
  input: unknown
  nowMs: number
  taskKindByToolUseId: Map<string, 'explore' | 'other'>
  exploreBatch: ExploreTaskBatch | null
  batchWindowMs?: number
}): ExploreTaskBatch | null {
  if (args.toolName !== 'Task') return args.exploreBatch

  const subagentType = (args.input as any)?.subagent_type
  const isExplore = String(subagentType || '') === 'Explore'
  args.taskKindByToolUseId.set(args.toolUseId, isExplore ? 'explore' : 'other')
  if (!isExplore) return args.exploreBatch

  const prevBatch = args.exploreBatch
  const windowMs = args.batchWindowMs ?? 1500
  const withinWindow = prevBatch && args.nowMs - prevBatch.lastSeenAtMs < windowMs
  const batch: ExploreTaskBatch =
    withinWindow && prevBatch
      ? prevBatch
      : { toolUseIds: new Set(), completedToolUseIds: new Set(), lastSeenAtMs: args.nowMs }
  batch.toolUseIds.add(args.toolUseId)
  batch.lastSeenAtMs = args.nowMs
  return batch
}

export function applyTaskStatsFromToolUpdate(args: {
  toolUseId: string
  toolUses: number | undefined
  usage: TokenUsage | undefined
  taskStatsByToolUseId: Map<string, TaskToolStats>
  nowMs: number
}): void {
  if (typeof args.toolUses === 'number') {
    const existing = args.taskStatsByToolUseId.get(args.toolUseId)
    if (existing) {
      existing.toolUses = args.toolUses
    } else {
      args.taskStatsByToolUseId.set(args.toolUseId, { startedAt: args.nowMs, toolUses: args.toolUses, usage: {} })
    }
  }

  if (args.usage) {
    const existing = args.taskStatsByToolUseId.get(args.toolUseId)
    if (existing) {
      existing.usage = args.usage
    } else {
      args.taskStatsByToolUseId.set(args.toolUseId, { startedAt: args.nowMs, toolUses: 0, usage: args.usage })
    }
  }
}

export function shouldApplyLegacyToolUpdate(args: {
  toolName: string | undefined
  event: Extract<StreamEvent, { type: 'tool_update' }>
}): boolean {
  const { event } = args
  return Boolean(
    event.middleLines ||
      event.nestedTools ||
      event.transcriptLines ||
      (args.toolName === 'Task' && (typeof event.toolUses === 'number' || event.usage)),
  )
}

export function finalizeExploreBatchOnTaskEnd(args: {
  toolUseId: string
  taskKind: 'explore' | 'other' | undefined
  exploreBatch: ExploreTaskBatch | null
  nowMs: number
}): { nextBatch: ExploreTaskBatch | null; summaryCount: number | null } {
  if (args.taskKind !== 'explore') {
    return { nextBatch: args.exploreBatch, summaryCount: null }
  }
  const batch = args.exploreBatch
  if (!batch || !batch.toolUseIds.has(args.toolUseId)) {
    return { nextBatch: batch, summaryCount: null }
  }

  batch.completedToolUseIds.add(args.toolUseId)
  batch.lastSeenAtMs = args.nowMs
  if (batch.toolUseIds.size >= 2 && batch.completedToolUseIds.size === batch.toolUseIds.size) {
    return { nextBatch: null, summaryCount: batch.toolUseIds.size }
  }
  return { nextBatch: batch, summaryCount: null }
}
