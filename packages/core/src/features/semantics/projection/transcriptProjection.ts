import type { CanonicalEvent } from '../core/canonicalEvents'
import {
  applyMessageProjectionEvent,
} from './transcriptProjectionMessageReducer'
import { applyNonMessageProjectionEvent } from './transcriptProjectionEventReducer'
import {
  finalizeProjectionReduction,
  prepareProjectionReduction,
} from './transcriptProjectionCore'
import { createTranscriptSegmentId } from './transcriptProjectionIds'
import type { TranscriptProjectionState } from './transcriptProjectionTypes'

export type {
  AssistantSegment,
  SystemSegment,
  ThinkingSegment,
  ToolSegment,
  TranscriptProjectionState,
  TranscriptSegment,
  TurnFooterSegment,
  UserSegment,
} from './transcriptProjectionTypes'

export function createInitialTranscriptProjectionState(args: { threadId: string }): TranscriptProjectionState {
  return {
    threadId: args.threadId,
    segments: [],
    seenEventIds: new Set<string>(),
    lastReplaySeq: 0,
    toolNameByUseId: {},
    openAssistantSegmentIdByTurn: {},
    openThinkingSegmentIdByTurn: {},
  }
}

export function reduceTranscriptProjection(state: TranscriptProjectionState, event: CanonicalEvent): TranscriptProjectionState {
  const prepared = prepareProjectionReduction({ state, event })
  if (prepared.kind === 'skip') {
    return prepared.state
  }
  const { seenEventIds, draft } = prepared

  const messageOutcome = applyMessageProjectionEvent({ draft, event, toSegmentId: createTranscriptSegmentId })
  if (messageOutcome === 'skip_turn') {
    return {
      ...state,
      seenEventIds,
      lastReplaySeq: event.replaySeq,
    }
  }

  applyNonMessageProjectionEvent({ draft, event, toSegmentId: createTranscriptSegmentId })

  return finalizeProjectionReduction({
    state,
    event,
    seenEventIds,
    draft,
  })
}

export function projectCanonicalEvents(
  state: TranscriptProjectionState,
  events: CanonicalEvent[],
): TranscriptProjectionState {
  return events.reduce((current, event) => reduceTranscriptProjection(current, event), state)
}
