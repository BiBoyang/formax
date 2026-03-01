import type { Msg } from '../../../../components/tool/ToolMessage'
import type { TokenUsage } from '../../../../streaming/types'
import type { ToolResult } from '../../../../tools/types'
import { formatToolResult } from '../../../../shared/utils/toolFormatting'
import { parseBackgroundTaskId, parseTaskTranscript } from '../send/taskResult'
import { formatDuration, formatTokenTotal, formatToolUses } from '../shared/utils'

export type TaskToolCompletionStats = {
  startedAt: number
  toolUses: number
  usage?: TokenUsage
}

export function buildCompletedToolMessage(args: {
  toolMessage: Msg | undefined
  toolUseId: string
  toolNameFromStart: string | undefined
  toolInputFromStart: unknown
  result: ToolResult
  taskStats: TaskToolCompletionStats | undefined
  editPatchStartLineNumber: number | null
}): Msg {
  const toolName = args.toolNameFromStart || args.toolMessage?.toolInfo?.name || 'Tool'
  const toolInput = args.toolInputFromStart ?? args.toolMessage?.toolInfo?.input ?? null
  const priorToolInfo = args.toolMessage?.toolInfo
  const baseId = args.toolMessage?.id ?? `tool-${args.toolUseId}`
  const baseTimestamp = args.toolMessage?.timestamp ?? new Date()
  const rawResult = args.result.content
  const displayResult =
    args.result.is_error && rawResult.startsWith('Error: ') ? rawResult.slice('Error: '.length) : rawResult

  if (toolName === 'Task') {
    const startedAt = args.taskStats?.startedAt ?? Date.now()
    const durationMs = Date.now() - startedAt
    const tokens = formatTokenTotal(args.taskStats?.usage)
    const backgroundTaskId = parseBackgroundTaskId(rawResult)
    const parsedTranscript = parseTaskTranscript(rawResult)
    const doneText = args.result.is_error
      ? displayResult || 'Error'
      : backgroundTaskId
        ? `Started (task_id: ${backgroundTaskId})`
        : `Done (${formatToolUses(args.taskStats?.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(durationMs)})`

    return {
      id: baseId,
      role: 'tool',
      content: doneText,
      timestamp: baseTimestamp,
      toolInfo: {
        ...(priorToolInfo ?? {}),
        name: toolName,
        toolUseId: args.toolUseId,
        input: (toolInput as any) || {},
        status: args.result.is_error ? 'error' : 'completed',
        result: rawResult,
        ...(parsedTranscript
          ? { transcriptLines: parsedTranscript }
          : priorToolInfo?.transcriptLines
            ? { transcriptLines: priorToolInfo.transcriptLines }
            : {}),
        ...(args.taskStats
          ? { toolUses: args.taskStats.toolUses, usage: args.taskStats.usage, durationMs }
          : { durationMs }),
      },
    }
  }

  if (toolName === 'Skill' && !args.result.is_error) {
    return {
      id: baseId,
      role: 'tool',
      content: '',
      timestamp: baseTimestamp,
      toolInfo: {
        name: toolName,
        toolUseId: args.toolUseId,
        input: (toolInput as any) || {},
        status: 'completed',
        result: rawResult,
      },
    }
  }

  const { summary, middleLines, expandInfo, lines } = formatToolResult(
    toolName,
    displayResult,
    Boolean(args.result.is_error),
  )

  return {
    id: baseId,
    role: 'tool',
    content: summary,
    timestamp: baseTimestamp,
    toolInfo: {
      name: toolName,
      toolUseId: args.toolUseId,
      input: (toolInput as any) || {},
      status: args.result.is_error ? 'error' : 'completed',
      result: rawResult,
      resultLines: lines,
      expandInfo,
      middleLines,
      ...(args.editPatchStartLineNumber !== null ? { patchStartLineNumber: args.editPatchStartLineNumber } : {}),
    },
  }
}
