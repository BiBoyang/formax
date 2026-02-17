import type { Msg } from '../../../../components/tool/ToolMessage'
import type { CanonicalEvent } from '../../../semantics/core/core'
import { reduceTranscriptProjection } from '../../../semantics/projection/projection'
import type { TranscriptProjectionState } from '../../../semantics/projection/projection'
import { canonicalTurnSegmentsToMessages, tailSegmentsForTurn } from './canonicalTurnMessages'

export function projectCanonicalEventToTransientMessages(args: {
  projection: TranscriptProjectionState
  event: CanonicalEvent
  activeTurnId: string | null
  includeAssistantStreaming: boolean
}): { projection: TranscriptProjectionState; messages: Msg[] } {
  const nextProjection = reduceTranscriptProjection(args.projection, args.event)
  const turnId = args.activeTurnId ?? args.event.turnId
  const turnTailSegments = tailSegmentsForTurn(nextProjection.segments, turnId)
  const messages = canonicalTurnSegmentsToMessages({
    turnId,
    segments: turnTailSegments,
    transientOnly: true,
    openAssistantSegmentId: nextProjection.openAssistantSegmentIdByTurn[turnId],
    includeAssistantStreaming: args.includeAssistantStreaming,
    includeUserSystem: false,
  })
  return { projection: nextProjection, messages }
}
