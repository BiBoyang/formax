import type { Msg } from '../../../../shared/toolMessageTypes'
import type { CanonicalEvent } from '../../../semantics/core'
import { reduceTranscriptProjection } from '../../../semantics/projection'
import type { TranscriptProjectionState } from '../../../semantics/projection'
import { canonicalTurnSegmentsToMessages, tailSegmentsForTurn } from './canonicalTurnMessages'

type PreviousTransientProjection = {
  turnId: string
  includeAssistantStreaming: boolean
  messages: Msg[]
}

export function projectCanonicalEventToTransientMessages(args: {
  projection: TranscriptProjectionState
  event: CanonicalEvent
  activeTurnId: string | null
  includeAssistantStreaming: boolean
  previousTransient?: PreviousTransientProjection | null
}): { projection: TranscriptProjectionState; messages: Msg[]; changed: boolean; turnId: string } {
  const turnId = args.activeTurnId ?? args.event.turnId
  const prevOpenAssistantSegmentId = args.projection.openAssistantSegmentIdByTurn[turnId] ?? null
  const nextProjection = reduceTranscriptProjection(args.projection, args.event)
  const nextOpenAssistantSegmentId = nextProjection.openAssistantSegmentIdByTurn[turnId] ?? null
  const projectionAffectsTransientRows =
    nextProjection.segments !== args.projection.segments || nextOpenAssistantSegmentId !== prevOpenAssistantSegmentId
  const previousTransient = args.previousTransient
  const canReusePreviousMessages =
    !projectionAffectsTransientRows &&
    Boolean(
      previousTransient &&
        previousTransient.turnId === turnId &&
        previousTransient.includeAssistantStreaming === args.includeAssistantStreaming,
    )

  if (canReusePreviousMessages && previousTransient) {
    return {
      projection: nextProjection,
      messages: previousTransient.messages,
      changed: false,
      turnId,
    }
  }

  const turnTailSegments = tailSegmentsForTurn(nextProjection.segments, turnId)
  const messages = canonicalTurnSegmentsToMessages({
    turnId,
    segments: turnTailSegments,
    transientOnly: true,
    openAssistantSegmentId: nextProjection.openAssistantSegmentIdByTurn[turnId],
    includeAssistantStreaming: args.includeAssistantStreaming,
    includeUserSystem: true,
  })
  return { projection: nextProjection, messages, changed: true, turnId }
}
