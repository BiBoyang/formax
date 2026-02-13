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

export function replaceTurnTailWithCanonicalMessages(args: {
  messages: Msg[]
  userMessageId: string
  canonicalTurnMessages: Msg[]
}): Msg[] {
  if (!args.userMessageId || args.canonicalTurnMessages.length === 0) return args.messages
  const userIndex = args.messages.findIndex((message) => message.id === args.userMessageId)
  if (userIndex < 0) return args.messages

  const head = args.messages.slice(0, userIndex + 1)
  const tail = args.messages.slice(userIndex + 1)
  const usedTailIndexes = new Set<number>()

  const withFallbackTimestamp = (message: Msg): Msg => {
    return { ...message }
  }

  const isAuxiliaryAssistantMessage = (message: Msg): boolean =>
    message.role === 'assistant' &&
    (message.ui?.kind === 'command_subline' ||
      message.ui?.kind === 'compact_boundary' ||
      message.ui?.kind === 'compact_banner')
  const shouldKeepLeftoverMessage = (message: Msg): boolean =>
    !(message.role === 'tool') && (message.role !== 'assistant' || isAuxiliaryAssistantMessage(message))

  const matchesCanonicalAssistantMessage = (message: Msg, canonicalMessage: Msg): boolean => {
    const canonicalText = String(canonicalMessage.content ?? '').trim()
    if (!canonicalText) return false
    const candidateText = String(message.content ?? '').trim()
    return candidateText === canonicalText || candidateText.includes(canonicalText)
  }

  const takeTailMessage = (predicate: (message: Msg) => boolean): Msg | null => {
    for (let index = 0; index < tail.length; index += 1) {
      if (usedTailIndexes.has(index)) continue
      const candidate = tail[index]
      if (!candidate || !predicate(candidate)) continue
      usedTailIndexes.add(index)
      return candidate
    }
    return null
  }

  const reorderedTail: Msg[] = []
  for (const canonicalMessage of args.canonicalTurnMessages) {
    if (canonicalMessage.role === 'tool') {
      const toolUseId = canonicalMessage.toolInfo?.toolUseId
      const legacyTool =
        toolUseId && toolUseId.length > 0
          ? takeTailMessage((message) => message.role === 'tool' && message.toolInfo?.toolUseId === toolUseId)
          : null
      reorderedTail.push(legacyTool ?? withFallbackTimestamp(canonicalMessage))
      continue
    }

    if (canonicalMessage.role === 'assistant' && canonicalMessage.ui?.kind === 'thinking_block') {
      const legacyThinking = takeTailMessage(
        (message) => message.role === 'assistant' && message.ui?.kind === 'thinking_block',
      )
      reorderedTail.push(legacyThinking ?? withFallbackTimestamp(canonicalMessage))
      continue
    }

    const legacyAssistant = takeTailMessage(
      (message) =>
        message.role === 'assistant' &&
        message.ui?.kind !== 'thinking_block' &&
        message.ui?.kind !== 'command_subline' &&
        matchesCanonicalAssistantMessage(message, canonicalMessage),
    )
    reorderedTail.push(
      legacyAssistant
        ? { ...legacyAssistant, isStreaming: false }
        : { ...withFallbackTimestamp(canonicalMessage), isStreaming: false },
    )
  }

  if (usedTailIndexes.size === 0) {
    const auxiliaryTail = tail.filter((message) => shouldKeepLeftoverMessage(message))
    return normalizeTailTimestamps([...head, ...auxiliaryTail, ...reorderedTail], userIndex)
  }

  const firstConsumedIndex = Math.min(...Array.from(usedTailIndexes))
  const leftoverPrefix = tail
    .slice(0, firstConsumedIndex)
    .filter((message, index) => !usedTailIndexes.has(index) && shouldKeepLeftoverMessage(message))
  const leftoverSuffix = tail
    .slice(firstConsumedIndex)
    .filter(
      (message, offset) =>
        !usedTailIndexes.has(firstConsumedIndex + offset) && shouldKeepLeftoverMessage(message),
    )
  return normalizeTailTimestamps([...head, ...leftoverPrefix, ...reorderedTail, ...leftoverSuffix], userIndex)
}

function normalizeTailTimestamps(messages: Msg[], anchorIndex: number): Msg[] {
  let lastTimestamp = 1
  return messages.map((message, index) => {
    const rawTimestamp = message.timestamp instanceof Date ? message.timestamp.getTime() : lastTimestamp
    if (index <= anchorIndex) {
      lastTimestamp = Math.max(lastTimestamp, rawTimestamp)
      return message
    }

    const normalizedTimestamp = Math.max(lastTimestamp, rawTimestamp, 1)
    lastTimestamp = normalizedTimestamp
    if (rawTimestamp === normalizedTimestamp) return message
    return { ...message, timestamp: new Date(normalizedTimestamp) }
  })
}
