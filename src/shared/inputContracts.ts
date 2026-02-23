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
