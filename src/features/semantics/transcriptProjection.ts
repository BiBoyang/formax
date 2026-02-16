import type {
  CanonicalEvent,
  CanonicalMessageUiKind,
  ToolInputKind,
  ToolInputStatus,
} from './canonicalEvents'
import type { TokenUsage } from '../../streaming/types'
import {
  reduceToolEvent,
  reduceToolInputStateEvent,
} from './transcriptProjectionToolReducer'
import { reduceTurnFooterEvent } from './transcriptProjectionTurnReducer'
import {
  reduceAssistantDeltaEvent,
  reduceThinkingDeltaEvent,
} from './transcriptProjectionTextReducer'
import {
  appendSystemMessageSegment,
  appendUserMessageSegment,
  shouldSkipMessageSegment,
} from './transcriptProjectionMessageReducer'

export type UserSegment = {
  id: string
  kind: 'user'
  turnId: string
  text: string
  uiKind?: Extract<CanonicalMessageUiKind, 'compact_summary'>
}

export type SystemSegment = {
  id: string
  kind: 'system'
  turnId: string
  role: 'assistant' | 'user'
  text: string
  uiKind?: CanonicalMessageUiKind
}

export type AssistantSegment = {
  id: string
  kind: 'assistant'
  turnId: string
  text: string
}

export type ThinkingSegment = {
  id: string
  kind: 'thinking'
  turnId: string
  text: string
  status: 'running' | 'finalized'
}

export type ToolSegment = {
  id: string
  kind: 'tool'
  turnId: string
  toolUseId: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
  input?: Record<string, unknown>
  result?: string
  resultLines?: number
  expandInfo?: string
  middleLines?: string[]
  transcriptLines?: string[]
  nestedTools?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    status: 'running' | 'completed' | 'error'
    summary?: string
  }>
  toolUses?: number
  usage?: TokenUsage
  durationMs?: number
  patchStartLineNumber?: number
  hideSummaryContent?: boolean
  startedAtMs?: number
  paramsText?: string
  inputState?: {
    kind: ToolInputKind
    status: ToolInputStatus
  }
}

export type TurnFooterSegment = {
  id: string
  kind: 'turn_footer'
  turnId: string
  status: 'completed' | 'failed' | 'interrupted'
  message?: string
}

export type TranscriptSegment =
  | UserSegment
  | SystemSegment
  | AssistantSegment
  | ThinkingSegment
  | ToolSegment
  | TurnFooterSegment

export type TranscriptProjectionState = {
  threadId: string
  segments: TranscriptSegment[]
  seenEventIds: Set<string>
  lastReplaySeq: number
  toolNameByUseId: Record<string, string>
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

function toSegmentId(args: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }): string {
  return args.suffix
    ? `${args.turnId}:${args.kind}:${args.replaySeq}:${args.suffix}`
    : `${args.turnId}:${args.kind}:${args.replaySeq}`
}

function findOpenSegmentIndexById(segments: TranscriptSegment[], id: string | undefined): number {
  if (!id) return -1
  return segments.findIndex((segment) => segment.id === id)
}

type ProjectionDraft = {
  segments: TranscriptSegment[]
  toolNameByUseId: Record<string, string>
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

function closeAssistantSegment(draft: ProjectionDraft, turnId: string): void {
  if (!Object.prototype.hasOwnProperty.call(draft.openAssistantSegmentIdByTurn, turnId)) return
  const next = { ...draft.openAssistantSegmentIdByTurn }
  delete next[turnId]
  draft.openAssistantSegmentIdByTurn = next
}

function closeThinkingSegment(draft: ProjectionDraft, turnId: string): void {
  const segmentId = draft.openThinkingSegmentIdByTurn[turnId]
  if (!segmentId) return
  const segmentIndex = findOpenSegmentIndexById(draft.segments, segmentId)
  if (segmentIndex >= 0) {
    const current = draft.segments[segmentIndex]
    if (current.kind === 'thinking' && current.status === 'running') {
      draft.segments[segmentIndex] = { ...current, status: 'finalized' }
    }
  }
  const next = { ...draft.openThinkingSegmentIdByTurn }
  delete next[turnId]
  draft.openThinkingSegmentIdByTurn = next
}

function closeTurnTextSegments(draft: ProjectionDraft, turnId: string): void {
  closeAssistantSegment(draft, turnId)
  closeThinkingSegment(draft, turnId)
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
  if (event.threadId !== state.threadId) return state
  if (state.seenEventIds.has(event.eventId)) return state

  const seenEventIds = new Set(state.seenEventIds)
  seenEventIds.add(event.eventId)
  if (event.replaySeq < state.lastReplaySeq) {
    return {
      ...state,
      seenEventIds,
    }
  }

  const draft: ProjectionDraft = {
    segments: [...state.segments],
    toolNameByUseId: { ...state.toolNameByUseId },
    openAssistantSegmentIdByTurn: { ...state.openAssistantSegmentIdByTurn },
    openThinkingSegmentIdByTurn: { ...state.openThinkingSegmentIdByTurn },
  }

  if (event.kind === 'user_message') {
    if (shouldSkipMessageSegment({ text: event.text, uiKind: event.uiKind })) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    appendUserMessageSegment({ draft, event, toSegmentId })
  }

  if (event.kind === 'system_message') {
    if (shouldSkipMessageSegment({ text: event.text, uiKind: event.uiKind })) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    appendSystemMessageSegment({ draft, event, toSegmentId })
  }

  if (event.kind === 'assistant_delta') {
    reduceAssistantDeltaEvent({
      draft,
      event,
      closeThinkingSegment: (turnId) => closeThinkingSegment(draft, turnId),
      toSegmentId,
    })
  }

  if (event.kind === 'thinking_delta') {
    reduceThinkingDeltaEvent({
      draft,
      event,
      closeAssistantSegment: (turnId) => closeAssistantSegment(draft, turnId),
      toSegmentId,
    })
  }

  if (event.kind === 'thinking_finalized') {
    closeThinkingSegment(draft, event.turnId)
  }

  if (event.kind === 'tool_event') {
    closeTurnTextSegments(draft, event.turnId)
    reduceToolEvent({ draft, event, toSegmentId })
  }

  if (event.kind === 'tool_input_state') {
    closeTurnTextSegments(draft, event.turnId)
    reduceToolInputStateEvent({ draft, event, toSegmentId })
  }

  if (event.kind === 'turn_footer') {
    closeTurnTextSegments(draft, event.turnId)
    reduceTurnFooterEvent({ draft, event, toSegmentId })
  }

  return {
    ...state,
    segments: draft.segments,
    toolNameByUseId: draft.toolNameByUseId,
    openAssistantSegmentIdByTurn: draft.openAssistantSegmentIdByTurn,
    openThinkingSegmentIdByTurn: draft.openThinkingSegmentIdByTurn,
    seenEventIds,
    lastReplaySeq: event.replaySeq,
  }
}

export function projectCanonicalEvents(
  state: TranscriptProjectionState,
  events: CanonicalEvent[],
): TranscriptProjectionState {
  return events.reduce((current, event) => reduceTranscriptProjection(current, event), state)
}
