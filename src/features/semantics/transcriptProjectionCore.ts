import type { CanonicalEvent } from './canonicalEvents'
import type { TranscriptProjectionState, TranscriptSegment } from './transcriptProjectionTypes'

export type ProjectionDraft = {
  segments: TranscriptSegment[]
  toolNameByUseId: Record<string, string>
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

export type ProjectionReducePrepared =
  | {
      kind: 'skip'
      state: TranscriptProjectionState
    }
  | {
      kind: 'proceed'
      seenEventIds: Set<string>
      draft: ProjectionDraft
    }

export function prepareProjectionReduction(args: {
  state: TranscriptProjectionState
  event: CanonicalEvent
}): ProjectionReducePrepared {
  const { state, event } = args
  if (event.threadId !== state.threadId) {
    return { kind: 'skip', state }
  }
  if (state.seenEventIds.has(event.eventId)) {
    return { kind: 'skip', state }
  }

  const seenEventIds = new Set(state.seenEventIds)
  seenEventIds.add(event.eventId)
  if (event.replaySeq < state.lastReplaySeq) {
    return {
      kind: 'skip',
      state: {
        ...state,
        seenEventIds,
      },
    }
  }

  return {
    kind: 'proceed',
    seenEventIds,
    draft: {
      segments: [...state.segments],
      toolNameByUseId: { ...state.toolNameByUseId },
      openAssistantSegmentIdByTurn: { ...state.openAssistantSegmentIdByTurn },
      openThinkingSegmentIdByTurn: { ...state.openThinkingSegmentIdByTurn },
    },
  }
}

export function finalizeProjectionReduction(args: {
  state: TranscriptProjectionState
  event: CanonicalEvent
  seenEventIds: Set<string>
  draft: ProjectionDraft
}): TranscriptProjectionState {
  return {
    ...args.state,
    segments: args.draft.segments,
    toolNameByUseId: args.draft.toolNameByUseId,
    openAssistantSegmentIdByTurn: args.draft.openAssistantSegmentIdByTurn,
    openThinkingSegmentIdByTurn: args.draft.openThinkingSegmentIdByTurn,
    seenEventIds: args.seenEventIds,
    lastReplaySeq: args.event.replaySeq,
  }
}
