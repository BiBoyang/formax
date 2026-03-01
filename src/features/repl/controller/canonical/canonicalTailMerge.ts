import type { Msg } from '../../../../shared/toolMessageTypes'
import type { TranscriptSegment } from '../../../semantics/projection/transcriptProjection'
import { canonicalTurnSegmentsToMessages, tailSegmentsForTurn } from './canonicalTurnMessageMapping'
import { type CanonicalTurnOutcome, computeCanonicalTurnAppend } from './canonicalTurnMerge'

export function appendCanonicalTailFinalRows(args: {
  messages: Msg[]
  turnId: string
  turnOutcome: CanonicalTurnOutcome
  projectionSegments: TranscriptSegment[]
}): Msg[] {
  const turnSegments = tailSegmentsForTurn(args.projectionSegments, args.turnId)
  const canonicalFinalMessages = canonicalTurnSegmentsToMessages({
    turnId: args.turnId,
    segments: turnSegments,
    includeUserSystem: false,
  })
  const { canonicalRowsForAppend, shouldAppendCanonicalFinal } = computeCanonicalTurnAppend({
    turnOutcome: args.turnOutcome,
    canonicalFinalMessages,
  })
  if (!shouldAppendCanonicalFinal || canonicalRowsForAppend.length === 0) return args.messages

  const legacyToolByUseId = new Map<string, Msg>()
  for (const message of args.messages) {
    if (message.role !== 'tool') continue
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) continue
    legacyToolByUseId.set(toolUseId, message)
  }
  const canonicalToolUseIds = new Set(
    canonicalRowsForAppend
      .filter((message) => message.role === 'tool')
      .map((message) => String(message.toolInfo?.toolUseId || '').trim())
      .filter((toolUseId) => toolUseId.length > 0),
  )

  const baseMessages = args.messages.filter((message) => {
    if (message.role !== 'tool') return true
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) return true
    return !canonicalToolUseIds.has(toolUseId)
  })

  let timestampCursor =
    baseMessages.length > 0 && baseMessages[baseMessages.length - 1]?.timestamp instanceof Date
      ? baseMessages[baseMessages.length - 1]!.timestamp.getTime()
      : Date.now()

  const mergedRows = canonicalRowsForAppend.map((message) => {
    let nextMessage: Msg = {
      ...message,
      isStreaming: false,
      timestamp: message.timestamp,
    }
    if (nextMessage.role === 'tool') {
      const toolUseId = String(nextMessage.toolInfo?.toolUseId || '').trim()
      if (toolUseId) {
        const legacyTool = legacyToolByUseId.get(toolUseId)
        if (legacyTool) {
          nextMessage = {
            ...nextMessage,
            id: legacyTool.id,
            timestamp: legacyTool.timestamp ?? nextMessage.timestamp,
            content: legacyTool.content || nextMessage.content,
            ...(nextMessage.toolInfo ? { toolInfo: nextMessage.toolInfo } : {}),
          }
        }
      }
    }
    const rawTs = nextMessage.timestamp instanceof Date ? nextMessage.timestamp.getTime() : Number.NaN
    if (!Number.isFinite(rawTs) || rawTs <= timestampCursor) {
      timestampCursor += 1
      return { ...nextMessage, timestamp: new Date(timestampCursor) }
    }
    timestampCursor = rawTs
    return nextMessage
  })

  return [...baseMessages, ...mergedRows]
}
