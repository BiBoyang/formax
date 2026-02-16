import type { CanonicalEvent } from './canonicalEvents'
import {
  reduceToolEvent,
  reduceToolInputStateEvent,
} from './transcriptProjectionToolReducer'
import { reduceTurnFooterEvent } from './transcriptProjectionTurnReducer'
import {
  reduceAssistantDeltaEvent,
  reduceThinkingDeltaEvent,
} from './transcriptProjectionTextReducer'
import { closeAssistantSegment, closeThinkingSegment, closeTurnTextSegments } from './transcriptProjectionLifecycleReducer'
import type { TranscriptSegment } from './transcriptProjection'
import type { ProjectionDraft } from './transcriptProjectionCore'

export function applyNonMessageProjectionEvent(args: {
  draft: ProjectionDraft
  event: CanonicalEvent
  toSegmentId: (input: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }) => string
}): void {
  const { draft, event, toSegmentId } = args
  if (event.kind === 'assistant_delta') {
    reduceAssistantDeltaEvent({
      draft,
      event,
      closeThinkingSegment: (turnId) => closeThinkingSegment(draft, turnId),
      toSegmentId,
    })
    return
  }

  if (event.kind === 'thinking_delta') {
    reduceThinkingDeltaEvent({
      draft,
      event,
      closeAssistantSegment: (turnId) => closeAssistantSegment(draft, turnId),
      toSegmentId,
    })
    return
  }

  if (event.kind === 'thinking_finalized') {
    closeThinkingSegment(draft, event.turnId)
    return
  }

  if (event.kind === 'tool_event') {
    closeTurnTextSegments(draft, event.turnId)
    reduceToolEvent({ draft, event, toSegmentId })
    return
  }

  if (event.kind === 'tool_input_state') {
    closeTurnTextSegments(draft, event.turnId)
    reduceToolInputStateEvent({ draft, event, toSegmentId })
    return
  }

  if (event.kind === 'turn_footer') {
    closeTurnTextSegments(draft, event.turnId)
    reduceTurnFooterEvent({ draft, event, toSegmentId })
  }
}
