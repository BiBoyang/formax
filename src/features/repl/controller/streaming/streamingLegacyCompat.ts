import type { StreamEvent } from '../../../../streaming/types'
import type { ToolResult } from '../../../../tools/types'
import { createRunningToolMessage, applyLegacyToolInputToMessages, applyLegacyToolUpdateToMessages } from './streamingLegacyToolRows'
import type { LegacyTranscriptMutator } from './streamingLegacyTranscript'
import { buildCompletedToolMessage, type TaskToolCompletionStats } from './streamingToolCompletion'
import { shouldApplyLegacyToolUpdate } from './streamingTaskState'

export function writeLegacyToolStartFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  toolUseId: string
  toolName: string
  toolMessageIdByToolUseId: Map<string, string>
  createToolMessageId: (toolUseId: string) => string
}): void {
  if (!args.legacyTranscript.canWrite) return
  const activeToolMsgId = args.toolMessageIdByToolUseId.get(args.toolUseId)
  if (activeToolMsgId) return

  const toolMsgId = args.createToolMessageId(args.toolUseId)
  args.toolMessageIdByToolUseId.set(args.toolUseId, toolMsgId)
  args.legacyTranscript.update((prev) => [
    ...prev,
    createRunningToolMessage({
      toolMsgId,
      toolUseId: args.toolUseId,
      toolName: args.toolName,
    }),
  ])
}

export function writeLegacyToolInputFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  toolUseId: string
  input: unknown
  toolMessageIdByToolUseId: Map<string, string>
}): void {
  if (!args.legacyTranscript.canWrite) return
  const toolMsgId = args.toolMessageIdByToolUseId.get(args.toolUseId) || `tool-${args.toolUseId}`
  args.legacyTranscript.update((prev) =>
    applyLegacyToolInputToMessages({
      previous: prev,
      toolMsgId,
      input: args.input,
    }),
  )
}

export function writeLegacyToolUpdateFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  toolUseId: string
  toolName: string | undefined
  event: Extract<StreamEvent, { type: 'tool_update' }>
  toolMessageIdByToolUseId: Map<string, string>
}): void {
  if (!args.legacyTranscript.canWrite) return
  if (!shouldApplyLegacyToolUpdate({ toolName: args.toolName, event: args.event })) return

  const toolMsgId = args.toolMessageIdByToolUseId.get(args.toolUseId) || `tool-${args.toolUseId}`
  args.legacyTranscript.update((prev) =>
    applyLegacyToolUpdateToMessages({
      previous: prev,
      toolMsgId,
      toolName: args.toolName,
      event: args.event,
    }),
  )
}

export function writeLegacyToolEndFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  toolUseId: string
  toolMsgId: string
  toolNameFromStart: string | undefined
  toolInputFromStart: unknown
  result: ToolResult
  taskStats: TaskToolCompletionStats | undefined
  workingCwd: string
  resolveEditPatchStartLineNumber: (args: {
    cwd: string
    toolName: string | undefined
    isError: boolean
    toolInput: unknown
  }) => number | null
}): void {
  if (!args.legacyTranscript.canWrite) return

  args.legacyTranscript.update((prev) => {
    const toolMsg = prev.find((message) => message.id === args.toolMsgId)
    const toolInput = args.toolInputFromStart ?? toolMsg?.toolInfo?.input ?? null
    const editPatchStartLineNumber = args.resolveEditPatchStartLineNumber({
      cwd: args.workingCwd,
      toolName: args.toolNameFromStart || toolMsg?.toolInfo?.name,
      isError: Boolean(args.result.is_error),
      toolInput,
    })
    const completedToolMessage = buildCompletedToolMessage({
      toolMessage: toolMsg,
      toolUseId: args.toolUseId,
      toolNameFromStart: args.toolNameFromStart,
      toolInputFromStart: args.toolInputFromStart,
      result: args.result,
      taskStats: args.taskStats,
      editPatchStartLineNumber,
    })
    return prev.map((message) =>
      message.id === args.toolMsgId ? { ...completedToolMessage, id: message.id, timestamp: message.timestamp } : message,
    )
  })
}
