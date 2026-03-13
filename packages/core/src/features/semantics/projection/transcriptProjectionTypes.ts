import type { CanonicalMessageUiKind, ToolInputKind, ToolInputStatus } from '../core/canonicalEvents'
import type { TokenUsage } from '@formax/shared/streaming'

export type UserSegment = {
  id: string
  kind: 'user'
  turnId: string
  text: string
  messageKind?: Extract<CanonicalMessageUiKind, 'compact_summary'>
}

export type SystemSegment = {
  id: string
  kind: 'system'
  turnId: string
  role: 'assistant' | 'user'
  text: string
  messageKind?: CanonicalMessageUiKind
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
  terminalSource?: 'tool_event' | 'turn_footer'
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
