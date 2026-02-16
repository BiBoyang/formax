import type {
  CanonicalEvent,
  CanonicalMessageUiKind,
  ToolInputKind,
  ToolInputStatus,
} from './canonicalEvents'
import type { TokenUsage } from '../../streaming/types'
import {
  appendSystemMessageSegment,
  appendUserMessageSegment,
  shouldSkipMessageSegment,
} from './transcriptProjectionMessageReducer'
import { applyNonMessageProjectionEvent } from './transcriptProjectionEventReducer'
import {
  finalizeProjectionReduction,
  prepareProjectionReduction,
} from './transcriptProjectionCore'

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
