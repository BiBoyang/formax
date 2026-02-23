import type { TraceContext } from '../../core/audit/schema.js'
import type {
  InputKind,
  InputPendingStatus,
  InputResolvedStatus,
  InputStatus,
  TurnInputSubmitStatus,
} from '../../shared/inputContracts.js'

export type {
  InputKind,
  InputPendingStatus,
  InputResolvedStatus,
  InputStatus,
  TurnInputSubmitStatus,
} from '../../shared/inputContracts.js'

/**
 * App-server input protocol only unifies lifecycle and transport shape.
 *
 * It intentionally does not merge business semantics:
 * - approval keeps permission/policy side effects.
 * - ask_user_question keeps tool question/answer semantics.
 */
export type InputEnvelopeMeta = {
  traceId: string
  seq: number
  ts: string
  eventId: string
  source: 'engine' | 'tool' | 'policy' | 'system'
  trace?: TraceContext
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
