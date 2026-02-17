import type { InputResolvedStatus, TurnInputSubmitStatus } from '../../../app-server/protocol/input.js'

export type InputStatePending = {
  status: 'pending'
  createdAt: string
  expiresAt: string
}

export type InputStateResolved = {
  status: InputResolvedStatus
  createdAt: string
  expiresAt: string
  resolvedAt: string
  reason?: string
  answersHash?: string
  submissionIds?: Set<string>
}

export type InputState = InputStatePending | InputStateResolved

export type SubmitInputTransition = {
  accepted: boolean
  submitStatus: TurnInputSubmitStatus
  nextState: InputState
}

export function transitionResolvedFromPending(args: {
  state: InputStatePending
  status: InputResolvedStatus
  resolvedAt: string
  reason?: string
}): InputStateResolved {
  if (args.status === 'submitted') {
    return {
      ...args.state,
      status: 'submitted',
      resolvedAt: args.resolvedAt,
      submissionIds: new Set<string>(),
    }
  }
  return {
    ...args.state,
    status: args.status,
    resolvedAt: args.resolvedAt,
    ...(args.reason ? { reason: args.reason } : {}),
    submissionIds: new Set<string>(),
  }
}

export function transitionInputSubmit(args: {
  state: InputState
  nowIso: string
  answersHash: string
  submissionId?: string
}): SubmitInputTransition {
  const { state, nowIso, answersHash, submissionId } = args
  if (state.status === 'pending') {
    if (Date.parse(nowIso) > Date.parse(state.expiresAt)) {
      return {
        accepted: false,
        submitStatus: 'expired',
        nextState: {
          ...state,
          status: 'expired',
          resolvedAt: nowIso,
          reason: 'input_expired',
          submissionIds: new Set<string>(),
        },
      }
    }
    const submissionIds = new Set<string>()
    if (submissionId) submissionIds.add(submissionId)
    return {
      accepted: true,
      submitStatus: 'accepted',
      nextState: {
        ...state,
        status: 'submitted',
        resolvedAt: nowIso,
        answersHash,
        submissionIds,
      },
    }
  }

  if (state.status === 'submitted') {
    const seenSubmissionIds = new Set(state.submissionIds ?? [])
    if (submissionId && seenSubmissionIds.has(submissionId)) {
      if (state.answersHash === answersHash) {
        return {
          accepted: true,
          submitStatus: 'already_submitted_same',
          nextState: state,
        }
      }
      return {
        accepted: false,
        submitStatus: 'conflict_already_submitted',
        nextState: state,
      }
    }

    if (state.answersHash === answersHash) {
      if (submissionId) seenSubmissionIds.add(submissionId)
      return {
        accepted: true,
        submitStatus: 'already_submitted_same',
        nextState: {
          ...state,
          submissionIds: seenSubmissionIds,
        },
      }
    }

    return {
      accepted: false,
      submitStatus: 'conflict_already_submitted',
      nextState: state,
    }
  }

  if (state.status === 'expired') {
    return { accepted: false, submitStatus: 'expired', nextState: state }
  }
  if (state.status === 'canceled') {
    return { accepted: false, submitStatus: 'canceled', nextState: state }
  }
  return { accepted: false, submitStatus: 'not_pending', nextState: state }
}

export function transitionResolvePending(args: {
  state: InputState
  status: Exclude<InputResolvedStatus, 'submitted'>
  resolvedAt: string
  reason?: string
}): InputState {
  if (args.state.status !== 'pending') return args.state
  return transitionResolvedFromPending({
    state: args.state,
    status: args.status,
    resolvedAt: args.resolvedAt,
    reason: args.reason,
  })
}
