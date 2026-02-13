import type { Msg } from '../../../components/tool/ToolMessage'
import type { TranscriptSegment } from '../../semantics/transcriptProjection'
import { parseToolParamsText } from '../../tools/presentation/paramsText'

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

function splitSummaryLines(summary: string): { firstLine: string; remainingLines: string[] } {
  const lines = String(summary ?? '').split(/\r?\n/)
  const firstLine = String(lines[0] ?? '')
  const remainingLines = lines.slice(1).map((line) => String(line ?? '')).filter((line) => line.length > 0)
  return { firstLine, remainingLines }
}

export function canonicalTurnSegmentsToMessages(args: {
  turnId: string
  segments: TranscriptSegment[]
  transientOnly?: boolean
  openAssistantSegmentId?: string
}): Msg[] {
  const turnSegments = args.segments.filter((segment) => segment.turnId === args.turnId)
  if (turnSegments.length === 0) return []

  const mapped = turnSegments.map((segment): Msg | null => {
    if (segment.kind === 'assistant') {
      if (args.transientOnly && segment.id !== args.openAssistantSegmentId) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        content: segment.text,
        timestamp: new Date(0),
        isStreaming: true,
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
    const summaryParts = splitSummaryLines(segment.summary)
    const middleLines = segment.detailLines.length > 0 ? segment.detailLines : summaryParts.remainingLines
    const resultLines = [summaryParts.firstLine, ...middleLines].filter((line) => line.length > 0)

    return {
      id: `canonical:${segment.id}`,
      role: 'tool' as const,
      content: summaryParts.firstLine,
      timestamp: new Date(0),
      toolInfo: {
        name: segment.toolName,
        toolUseId: segment.toolUseId,
        input: parseToolInputFromParamsText(segment.paramsText),
        status: segment.status,
        result: resultLines.join('\n') || summaryParts.firstLine,
        middleLines,
      },
    }
  })

  return mapped.filter((message): message is Msg => message !== null)
}
