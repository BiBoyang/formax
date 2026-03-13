import type { TokenUsage } from '../../../../streaming/types'

export type TaskStatsSnapshot = {
  startedAt: number
  toolUses: number
  usage?: TokenUsage
}

export type ToolEndStateSnapshot = {
  toolMsgId: string
  toolNameFromStart: string | undefined
  toolInputFromStart: unknown
  taskKind: 'explore' | 'other' | undefined
  taskStats: TaskStatsSnapshot | undefined
}

export function consumeToolEndState(args: {
  toolUseId: string
  toolMessageIdByToolUseId: Map<string, string>
  toolNameById: Map<string, string>
  toolInputById: Map<string, unknown>
  taskKindByToolUseId: Map<string, 'explore' | 'other'>
  taskStatsByToolUseId: Map<string, TaskStatsSnapshot>
}): ToolEndStateSnapshot {
  const toolMsgId = args.toolMessageIdByToolUseId.get(args.toolUseId) || `tool-${args.toolUseId}`
  args.toolMessageIdByToolUseId.delete(args.toolUseId)

  const toolNameFromStart = args.toolNameById.get(args.toolUseId)
  args.toolNameById.delete(args.toolUseId)

  const toolInputFromStart = args.toolInputById.get(args.toolUseId)
  args.toolInputById.delete(args.toolUseId)

  const taskKind = args.taskKindByToolUseId.get(args.toolUseId)
  args.taskKindByToolUseId.delete(args.toolUseId)

  const taskStats = args.taskStatsByToolUseId.get(args.toolUseId)
  args.taskStatsByToolUseId.delete(args.toolUseId)

  return {
    toolMsgId,
    toolNameFromStart,
    toolInputFromStart,
    taskKind,
    taskStats,
  }
}
