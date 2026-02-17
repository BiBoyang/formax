import type { StreamEvent } from '../../../../streaming/types'
import type { ToolResult } from '../../../../tools/types'
import { createRunningToolMessage, applyLegacyToolInputToMessages, applyLegacyToolUpdateToMessages } from './streamingLegacyToolRows'
import type { LegacyTranscriptMutator } from './streamingLegacyTranscript'
import { buildCompletedToolMessage, type TaskToolCompletionStats } from './streamingToolCompletion'
import { shouldApplyLegacyToolUpdate } from './streamingTaskState'
import {
  appendAssistantDeltaToMessages,
  createAssistantStreamingMessage,
  createThinkingBlockMessage,
  updateThinkingBlockContent,
} from './streamingTextRows'

export function writeLegacyAssistantDeltaFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  assistantId: string | null
  text: string
  createAssistantId: () => string
}): string | null {
  if (!args.legacyTranscript.canWrite) return args.assistantId

  if (!args.assistantId) {
    const nextAssistantId = args.createAssistantId()
    args.legacyTranscript.update((prev) => [
      ...prev,
      createAssistantStreamingMessage({
        assistantId: nextAssistantId,
        text: args.text,
      }),
    ])
    return nextAssistantId
  }

  args.legacyTranscript.update((prev) =>
    appendAssistantDeltaToMessages({
      previous: prev,
      assistantId: args.assistantId,
      text: args.text,
    }),
  )
  return args.assistantId
}

export function writeLegacyThinkingStartFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  thinkingId: string
  text: string
}): void {
  if (!args.legacyTranscript.canWrite) return
  args.legacyTranscript.update((prev) => [
    ...prev,
    createThinkingBlockMessage({
      thinkingId: args.thinkingId,
      text: args.text,
    }),
  ])
}

export function writeLegacyThinkingUpdateFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  thinkingId: string
  text: string
}): void {
  if (!args.legacyTranscript.canWrite) return
  args.legacyTranscript.update((prev) =>
    updateThinkingBlockContent({
      previous: prev,
      thinkingId: args.thinkingId,
      text: args.text,
    }),
  )
}

export function writeLegacyExploreSummaryFallback(args: {
  legacyTranscript: LegacyTranscriptMutator
  count: number
  createAssistantId: () => string
}): void {
  if (!args.legacyTranscript.canWrite) return
  args.legacyTranscript.update((prev) => [
    ...prev,
    {
      id: args.createAssistantId(),
      role: 'assistant',
      content: `${args.count} Explore agents finished (ctrl+o to expand)`,
      timestamp: new Date(),
    },
  ])
}

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
