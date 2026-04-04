import type { InputKind, InputStatus } from '@formax/shared/inputContracts'
import type { TokenUsage } from '@formax/shared/streaming'
import type { PromptMessageMeta } from '../../../prompts/types'

export type CanonicalEventSource = 'engine' | 'tool' | 'policy' | 'system' | 'ui'
export const CANONICAL_EVENT_SCHEMA_VERSION = 1 as const
export type CanonicalEventSchemaVersion = typeof CANONICAL_EVENT_SCHEMA_VERSION

export type ToolInputKind = InputKind
export type ToolInputStatus = InputStatus
export type CanonicalMessageUiKind = 'command_subline' | 'compact_boundary' | 'compact_banner' | 'compact_summary'

export type CanonicalEventEnvelope = {
  schemaVersion?: CanonicalEventSchemaVersion
  threadId: string
  replaySeq: number
  eventId: string
  ts: string
  source: CanonicalEventSource
  traceId?: string
  seq?: number
}

export type CanonicalAssistantDeltaEvent = CanonicalEventEnvelope & {
  kind: 'assistant_delta'
  turnId: string
  textDelta: string
}

export type CanonicalThinkingDeltaEvent = CanonicalEventEnvelope & {
  kind: 'thinking_delta'
  turnId: string
  textDelta: string
}

export type CanonicalThinkingFinalizedEvent = CanonicalEventEnvelope & {
  kind: 'thinking_finalized'
  turnId: string
}

export type CanonicalToolEvent = CanonicalEventEnvelope & {
  kind: 'tool_event'
  turnId: string
  toolUseId: string
  phase: 'start' | 'update' | 'end'
  toolName?: string
  input?: Record<string, unknown>
  paramsText?: string
  line?: string
  summary?: string
  isError?: boolean
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
}

export type CanonicalToolInputStateEvent = CanonicalEventEnvelope & {
  kind: 'tool_input_state'
  turnId: string
  toolUseId: string
  inputKind: ToolInputKind
  status: ToolInputStatus
  toolName?: string
}

export type CanonicalTurnFooterEvent = CanonicalEventEnvelope & {
  kind: 'turn_footer'
  turnId: string
  status: 'completed' | 'failed' | 'interrupted'
  message?: string
}

export type CanonicalUserMessageEvent = CanonicalEventEnvelope & {
  kind: 'user_message'
  turnId: string
  text: string
  uiKind?: Extract<CanonicalMessageUiKind, 'compact_summary'>
}

export type CanonicalSystemMessageEvent = CanonicalEventEnvelope & {
  kind: 'system_message'
  turnId: string
  role: 'assistant' | 'user'
  text: string
  uiKind?: CanonicalMessageUiKind
  compactBoundary?: PromptMessageMeta['compactBoundary']
}

export type CanonicalEvent =
  | CanonicalUserMessageEvent
  | CanonicalSystemMessageEvent
  | CanonicalAssistantDeltaEvent
  | CanonicalThinkingDeltaEvent
  | CanonicalThinkingFinalizedEvent
  | CanonicalToolEvent
  | CanonicalToolInputStateEvent
  | CanonicalTurnFooterEvent

export function isCanonicalEventSource(value: unknown): value is CanonicalEventSource {
  return value === 'engine' || value === 'tool' || value === 'policy' || value === 'system' || value === 'ui'
}

export function isCanonicalEventSchemaVersion(value: unknown): value is CanonicalEventSchemaVersion {
  return value === CANONICAL_EVENT_SCHEMA_VERSION
}
