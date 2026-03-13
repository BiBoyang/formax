import type { Msg } from '../../../../shared/toolMessageTypes'
import type { TranscriptSegment } from '../../../semantics/projection/transcriptProjection'
import { selectTailSegmentsForTurn } from '../../../semantics/selectors/transcriptSegments'
import { selectToolPresentation } from '../../../semantics/selectors/toolPresentation'
import { parseToolParamsText } from '../../../tools/presentation/paramsText'
import { formatDuration, formatTokenTotal, formatToolUses } from '../shared/utils'
import { formatToolResult } from '../../../../shared/utils/toolFormatting'
import { parseTaskTranscript } from '../../../semantics/selectors/taskResultParsing'

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

function shouldUseSummaryRemainderFallback(args: { hasRawResult: boolean }): boolean {
  // When we already have a raw tool result, `formatToolResult` is the canonical
  // source for summary/detail projection. Falling back to multi-line `summary`
  // causes Read/Glob/Grep rows to re-expand full payload content in TUI.
  if (args.hasRawResult) return false
  return true
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
        surfaceOwner: 'static' as const,
        ...(segment.messageKind ? { ui: { kind: segment.messageKind } } : {}),
      }
    }

    if (segment.kind === 'system') {
      if (args.includeUserSystem === false) return null
      return {
        id: `canonical:${segment.id}`,
        role: segment.role,
        content: segment.text,
        timestamp: new Date(0),
        surfaceOwner: 'static' as const,
        ...(segment.messageKind ? { ui: { kind: segment.messageKind } } : {}),
      }
    }

    if (segment.kind === 'assistant') {
      const allowAssistantStreaming = args.includeAssistantStreaming ?? true
      if (!args.transientOnly) {
        return {
          id: `canonical:${segment.id}`,
          role: 'assistant' as const,
          content: segment.text,
          timestamp: new Date(0),
          surfaceOwner: 'static' as const,
        }
      }

      const openAssistantSegmentId = args.openAssistantSegmentId ?? null

	      if (allowAssistantStreaming) {
	        const isOpen = Boolean(openAssistantSegmentId && segment.id === openAssistantSegmentId)
	        return {
	          id: `canonical:${segment.id}`,
	          role: 'assistant' as const,
	          content: segment.text,
	          timestamp: new Date(0),
	          surfaceOwner: isOpen ? 'transient' : 'static',
	          ...(isOpen ? { isStreaming: true } : {}),
	        }
	      }

      if (openAssistantSegmentId && segment.id === openAssistantSegmentId) return null
      const assistantSurfaceOwner = 'static' as const
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        content: segment.text,
        timestamp: new Date(0),
        surfaceOwner: assistantSurfaceOwner,
      }
    }

    if (segment.kind === 'thinking') {
      if (args.transientOnly) {
        if (segment.status !== 'finalized') return null
        return {
          id: `canonical:${segment.id}`,
          role: 'assistant' as const,
          ui: { kind: 'thinking_block' as const },
          content: segment.text,
          timestamp: new Date(0),
          surfaceOwner: 'static' as const,
        }
      }
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        ui: { kind: 'thinking_block' as const },
        content: segment.text,
        timestamp: new Date(0),
        surfaceOwner: 'static' as const,
      }
    }

    if (segment.kind !== 'tool') return null
    const toolMessageId = `canonical:${args.turnId}:tool:${segment.toolUseId}`
    const isRunningTool = segment.status === 'running'
    const toolSurfaceOwner =
      args.transientOnly && isRunningTool ? ('transient' as const) : ('static' as const)
    const input = segment.input ?? parseToolInputFromParamsText(segment.paramsText)
    const rawResult = segment.result
    const isError = segment.status === 'error'
    const summary = selectToolPresentation(segment)

    if (segment.toolName === 'Task') {
      const tokens = formatTokenTotal(segment.usage)
      const summaryText =
        segment.status === 'running'
          ? summary.taskSummaryLine
          : isError
            ? summary.taskSummaryLine
            : summary.taskCompletion?.kind === 'started'
              ? `Started (task_id: ${summary.taskCompletion.taskId})`
              : `Done (${formatToolUses(segment.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                segment.durationMs ?? 0,
              )})`
      const transcriptLines = parseTaskTranscript(rawResult ?? '') ?? segment.transcriptLines ?? undefined
      return {
        id: toolMessageId,
        role: 'tool' as const,
        content: summaryText,
        timestamp: new Date(0),
        surfaceOwner: toolSurfaceOwner,
        ...(args.transientOnly && isRunningTool ? { isStreaming: true } : {}),
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
      (segment.detailLines.length > 0
        ? segment.detailLines
        : shouldUseSummaryRemainderFallback({
            hasRawResult: typeof displayResult === 'string',
          })
          ? summary.remainingSummaryLines
          : [])
    const resultLines =
      formatted?.lines ?? segment.resultLines ?? [firstLine, ...middleLines].join('\n').split(/\r?\n/).length
    const hideSummaryContent = summary.hideSummaryContent
    const content = hideSummaryContent ? '' : firstLine
    const patchStartLineNumber = segment.patchStartLineNumber ?? null

    return {
      id: toolMessageId,
      role: 'tool' as const,
      content,
      timestamp: new Date(0),
      surfaceOwner: toolSurfaceOwner,
      ...(args.transientOnly && isRunningTool ? { isStreaming: true } : {}),
      toolInfo: {
        name: segment.toolName,
        toolUseId: segment.toolUseId,
        input,
        status: segment.status,
        result: rawResult ?? [firstLine, ...middleLines].filter((line) => line.length > 0).join('\n'),
        middleLines,
        ...(formatted?.expandInfo || segment.expandInfo ? { expandInfo: segment.expandInfo ?? formatted?.expandInfo } : {}),
        resultLines,
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
