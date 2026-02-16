import type { CanonicalEvent } from './canonicalEvents'
import {
  applyMessageProjectionEvent,
} from './transcriptProjectionMessageReducer'
import { applyNonMessageProjectionEvent } from './transcriptProjectionEventReducer'
import {
  finalizeProjectionReduction,
  prepareProjectionReduction,
} from './transcriptProjectionCore'
import type { TranscriptProjectionState, TranscriptSegment } from './transcriptProjectionTypes'

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

function toSegmentId(args: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }): string {
  return args.suffix
    ? `${args.turnId}:${args.kind}:${args.replaySeq}:${args.suffix}`
    : `${args.turnId}:${args.kind}:${args.replaySeq}`
}

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

  const messageOutcome = applyMessageProjectionEvent({ draft, event, toSegmentId })
  if (messageOutcome === 'skip_turn') {
    return {
      ...state,
      seenEventIds,
      lastReplaySeq: event.replaySeq,
    }
  }

  applyNonMessageProjectionEvent({ draft, event, toSegmentId })

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
