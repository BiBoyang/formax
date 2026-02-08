/**
 * App-server input protocol only unifies lifecycle and transport shape.
 *
 * It intentionally does not merge business semantics:
 * - approval keeps permission/policy side effects.
 * - ask_user_question keeps tool question/answer semantics.
 */
export type InputKind = 'approval' | 'ask_user_question'

export type InputPendingStatus = 'pending'

export type InputResolvedStatus = 'submitted' | 'canceled' | 'expired' | 'failed'

export type InputStatus = InputPendingStatus | InputResolvedStatus

export type TurnInputSubmitStatus =
  | 'accepted'
  | 'already_submitted_same'
  | 'conflict_already_submitted'
  | 'not_pending'
  | 'expired'
  | 'canceled'

export type InputEnvelopeMeta = {
  traceId: string
  seq: number
  ts: string
  eventId: string
  source: 'engine' | 'tool' | 'policy' | 'system'
}

export type ApprovalInputPayload = {
  toolName: string
  action: unknown
  effectiveDecision: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
}

export type AskUserQuestionInputPayload = {
  questions: Array<{
    question: string
    header: string
    fieldId?: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}

export type InputRequestedPayload = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: InputKind
  status: InputPendingStatus
  createdAt: string
  expiresAt: string
  payload: ApprovalInputPayload | AskUserQuestionInputPayload
}

export type InputResolvedPayload = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: InputKind
  status: InputResolvedStatus
  createdAt: string
  expiresAt: string
  resolvedAt: string
  reason?: string
}

export type TurnInputSubmitResult = {
  accepted: boolean
  status: TurnInputSubmitStatus
}
