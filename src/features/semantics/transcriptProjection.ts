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
    if (!event.text && !event.uiKind) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    const next: UserSegment = {
      id: toSegmentId({ kind: 'user', replaySeq: event.replaySeq, turnId: event.turnId }),
      kind: 'user',
      turnId: event.turnId,
      text: event.text,
      ...(event.uiKind ? { uiKind: event.uiKind } : {}),
    }
    draft.segments.push(next)
  }

  if (event.kind === 'system_message') {
    if (!event.text && !event.uiKind) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    const next: SystemSegment = {
      id: toSegmentId({ kind: 'system', replaySeq: event.replaySeq, turnId: event.turnId }),
      kind: 'system',
      turnId: event.turnId,
      role: event.role,
      text: event.text,
      ...(event.uiKind ? { uiKind: event.uiKind } : {}),
    }
    draft.segments.push(next)
  }

  if (event.kind === 'assistant_delta') {
    const text = event.textDelta
    if (text) {
      closeThinkingSegment(draft, event.turnId)
      const openId = draft.openAssistantSegmentIdByTurn[event.turnId]
      const openIndex = findOpenSegmentIndexById(draft.segments, openId)
      if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'assistant') {
        const current = draft.segments[openIndex] as AssistantSegment
        draft.segments[openIndex] = { ...current, text: current.text + text }
      } else {
        const next: AssistantSegment = {
          id: toSegmentId({ kind: 'assistant', replaySeq: event.replaySeq, turnId: event.turnId }),
          kind: 'assistant',
          turnId: event.turnId,
          text,
        }
        draft.segments.push(next)
        draft.openAssistantSegmentIdByTurn[event.turnId] = next.id
      }
    }
  }

  if (event.kind === 'thinking_delta') {
    const text = event.textDelta
    if (text) {
      closeAssistantSegment(draft, event.turnId)
      const openId = draft.openThinkingSegmentIdByTurn[event.turnId]
      const openIndex = findOpenSegmentIndexById(draft.segments, openId)
      if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'thinking') {
        const current = draft.segments[openIndex] as ThinkingSegment
        draft.segments[openIndex] = { ...current, text: current.text + text }
      } else {
        const next: ThinkingSegment = {
          id: toSegmentId({ kind: 'thinking', replaySeq: event.replaySeq, turnId: event.turnId }),
          kind: 'thinking',
          turnId: event.turnId,
          text,
          status: 'running',
        }
        draft.segments.push(next)
        draft.openThinkingSegmentIdByTurn[event.turnId] = next.id
      }
    }
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
    const existingIndex = draft.segments.findIndex(
      (segment) => segment.kind === 'turn_footer' && segment.turnId === event.turnId,
    )
    if (existingIndex >= 0) {
      const current = draft.segments[existingIndex]
      if (current.kind === 'turn_footer') {
        draft.segments[existingIndex] = {
          ...current,
          status: event.status,
          ...(event.message ? { message: event.message } : {}),
        }
      }
    } else {
      const next: TurnFooterSegment = {
        id: toSegmentId({ kind: 'turn_footer', replaySeq: event.replaySeq, turnId: event.turnId }),
        kind: 'turn_footer',
        turnId: event.turnId,
        status: event.status,
        ...(event.message ? { message: event.message } : {}),
      }
      draft.segments.push(next)
    }
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
