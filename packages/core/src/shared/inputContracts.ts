export type InputKind = 'approval' | 'ask_user_question'

export type InputPendingStatus = 'pending'

export type InputResolvedStatus = 'submitted' | 'canceled' | 'expired' | 'failed'

export type InputStatus = InputPendingStatus | InputResolvedStatus

export type InputPromptSource = 'policy' | 'tool'

export type TurnInputSubmitStatus =
  | 'accepted'
  | 'already_submitted_same'
  | 'conflict_already_submitted'
  | 'not_pending'
  | 'expired'
  | 'canceled'

export function isInputKind(value: unknown): value is InputKind {
  return value === 'approval' || value === 'ask_user_question'
}

export function isInputPendingStatus(value: unknown): value is InputPendingStatus {
  return value === 'pending'
}

export function isInputResolvedStatus(value: unknown): value is InputResolvedStatus {
  return value === 'submitted' || value === 'canceled' || value === 'expired' || value === 'failed'
}

export function isInputStatus(value: unknown): value is InputStatus {
  return isInputPendingStatus(value) || isInputResolvedStatus(value)
}

export function sourceFromInputKind(kind: InputKind): InputPromptSource {
  return kind === 'approval' ? 'policy' : 'tool'
}
