import type { Msg } from '../../../../components/tool/ToolMessage'
import type { TranscriptSegment } from '../../../semantics/projection/transcriptProjection'
import { selectTailSegmentsForTurn } from '../../../semantics/selectors/transcriptSegments'
import { selectToolPresentation } from '../../../semantics/selectors/toolPresentation'
import { parseToolParamsText } from '../../../tools/presentation/paramsText'
import { formatDuration, formatTokenTotal, formatToolUses } from '../shared/utils'
import { formatToolResult } from '../../../../utils/toolFormatting'
import { parseBackgroundTaskId, parseTaskTranscript } from '../send/taskResult'

function decodeParamValue(value: string, valueType: 'string' | 'json'): unknown {
  if (valueType === 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseToolInputFromParamsText(paramsText: string | undefined): Record<string, unknown> {
  const parsed = parseToolParamsText(paramsText)
  if (parsed.length === 0) return {}
  const out: Record<string, unknown> = {}
  for (const entry of parsed) {
    out[entry.label] = decodeParamValue(entry.value, entry.valueType)
  }
  return out
}

export function canonicalTurnSegmentsToMessages(args: {
  turnId: string
  segments: TranscriptSegment[]
  transientOnly?: boolean
  openAssistantSegmentId?: string
  includeAssistantStreaming?: boolean
  includeUserSystem?: boolean
}): Msg[] {
  const turnSegments = args.segments.filter((segment) => segment.turnId === args.turnId)
  if (turnSegments.length === 0) return []

  const mapped = turnSegments.map((segment): Msg | null => {
    if (segment.kind === 'user') {
      if (args.includeUserSystem === false) return null
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'user' as const,
        content: segment.text,
        timestamp: new Date(0),
        ...(segment.messageKind ? { ui: { kind: segment.messageKind } } : {}),
      }
    }

    if (segment.kind === 'system') {
      if (args.includeUserSystem === false) return null
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: segment.role,
        content: segment.text,
        timestamp: new Date(0),
        ...(segment.messageKind ? { ui: { kind: segment.messageKind } } : {}),
      }
    }

    if (segment.kind === 'assistant') {
      const allowAssistantStreaming = args.includeAssistantStreaming ?? true
      if (args.transientOnly && !allowAssistantStreaming) return null
      if (args.transientOnly && segment.id !== args.openAssistantSegmentId) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        content: segment.text,
        timestamp: new Date(0),
        ...(args.transientOnly ? { isStreaming: true } : {}),
      }
    }

    if (segment.kind === 'thinking') {
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        ui: { kind: 'thinking_block' as const },
        content: segment.text,
        timestamp: new Date(0),
      }
    }

    if (segment.kind !== 'tool') return null
    if (args.transientOnly && segment.status !== 'running') return null
    const input = segment.input ?? parseToolInputFromParamsText(segment.paramsText)
    const rawResult = segment.result
    const isError = segment.status === 'error'
    const summary = selectToolPresentation(segment)
    const normalizedErrorSummary = summary.firstLine.startsWith('Error: ')
      ? summary.firstLine.slice('Error: '.length)
      : summary.firstLine

    if (segment.toolName === 'Task') {
      const tokens = formatTokenTotal(segment.usage)
      const backgroundTaskId = parseBackgroundTaskId(rawResult ?? '')
      const summaryText =
        segment.status === 'running'
          ? summary.firstLine || 'Task running'
          : isError
            ? normalizedErrorSummary || 'Error'
            : backgroundTaskId
                ? `Started (task_id: ${backgroundTaskId})`
                : `Done (${formatToolUses(segment.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                  segment.durationMs ?? 0,
                )})`
      const transcriptLines = parseTaskTranscript(rawResult ?? '') ?? segment.transcriptLines ?? undefined
      return {
        id: `canonical:${segment.id}`,
        role: 'tool' as const,
        content: summaryText,
        timestamp: new Date(0),
        toolInfo: {
          name: segment.toolName,
          toolUseId: segment.toolUseId,
          input,
          status: segment.status,
          result: rawResult ?? segment.summary,
          ...(transcriptLines ? { transcriptLines } : {}),
          ...(segment.nestedTools ? { nestedTools: segment.nestedTools } : {}),
          ...(segment.toolUses !== undefined ? { toolUses: segment.toolUses } : {}),
          ...(segment.usage ? { usage: segment.usage } : {}),
          ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
          ...(segment.middleLines ? { middleLines: segment.middleLines } : {}),
          ...(segment.expandInfo ? { expandInfo: segment.expandInfo } : {}),
        },
      }
    }

    const displayResult =
      isError && typeof rawResult === 'string' && rawResult.startsWith('Error: ')
        ? rawResult.slice('Error: '.length)
        : rawResult
    const formatted = typeof displayResult === 'string' ? formatToolResult(segment.toolName, displayResult, isError) : null
    const firstLine = formatted?.summary ?? summary.firstLine
    const middleLines =
      segment.middleLines ??
      formatted?.middleLines ??
      (segment.detailLines.length > 0 ? segment.detailLines : summary.remainingSummaryLines)
    const resultLines = (formatted?.lines ?? segment.resultLines ?? [firstLine, ...middleLines].join('\n').split(/\r?\n/).length)
    const hideSummaryContent = Boolean(
      segment.hideSummaryContent ?? (segment.toolName === 'Skill' && segment.status === 'completed' && !isError),
    )
    const content = hideSummaryContent ? '' : firstLine
    const patchStartLineNumber = segment.patchStartLineNumber ?? null

    return {
      id: `canonical:${segment.id}`,
      role: 'tool' as const,
      content,
      timestamp: new Date(0),
      toolInfo: {
        name: segment.toolName,
        toolUseId: segment.toolUseId,
        input,
        status: segment.status,
        result: rawResult ?? [firstLine, ...middleLines].filter((line) => line.length > 0).join('\n'),
        middleLines,
        ...(formatted?.expandInfo || segment.expandInfo ? { expandInfo: segment.expandInfo ?? formatted?.expandInfo } : {}),
        ...(resultLines !== undefined ? { resultLines } : {}),
        ...(segment.transcriptLines ? { transcriptLines: segment.transcriptLines } : {}),
        ...(segment.nestedTools ? { nestedTools: segment.nestedTools } : {}),
        ...(segment.toolUses !== undefined ? { toolUses: segment.toolUses } : {}),
        ...(segment.usage ? { usage: segment.usage } : {}),
        ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
        ...(patchStartLineNumber !== null ? { patchStartLineNumber } : {}),
      },
    }
  })

  return mapped.filter((message): message is Msg => message !== null)
}

export function tailSegmentsForTurn(segments: TranscriptSegment[], turnId: string): TranscriptSegment[] {
  return selectTailSegmentsForTurn(segments, turnId)
}
