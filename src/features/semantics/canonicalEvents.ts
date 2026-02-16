export type CanonicalEventSource = 'engine' | 'tool' | 'policy' | 'system' | 'ui'

export type ToolInputKind = 'approval' | 'ask_user_question'
export type ToolInputStatus = 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
export type CanonicalMessageUiKind = 'command_subline' | 'compact_boundary' | 'compact_banner' | 'compact_summary'

export type CanonicalEventEnvelope = {
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
  paramsText?: string
  line?: string
  summary?: string
  isError?: boolean
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
