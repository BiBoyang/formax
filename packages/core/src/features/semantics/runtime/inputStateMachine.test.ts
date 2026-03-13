import { describe, expect, it } from 'vitest'
import { transitionInputSubmit, transitionResolvePending, transitionResolvedFromPending } from './inputStateMachine.js'

describe('inputStateMachine', () => {
  it('submits pending input before expiry', () => {
    const out = transitionInputSubmit({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      nowIso: '2026-02-10T00:05:00.000Z',
      answersHash: 'hash-a',
      submissionId: 'sub-1',
    })

    expect(out.accepted).toBe(true)
    expect(out.submitStatus).toBe('accepted')
    expect(out.nextState.status).toBe('submitted')
  })

  it('expires pending input after ttl', () => {
    const out = transitionInputSubmit({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      nowIso: '2026-02-10T00:10:00.001Z',
      answersHash: 'hash-a',
    })

    expect(out.accepted).toBe(false)
    expect(out.submitStatus).toBe('expired')
    if (out.nextState.status !== 'expired') {
      throw new Error('expected expired state')
    }
    expect(out.nextState.reason).toBe('input_expired')
  })

  it('is idempotent for same submission and rejects conflicting answers', () => {
    const submittedState = {
      status: 'submitted' as const,
      createdAt: '2026-02-10T00:00:00.000Z',
      expiresAt: '2026-02-10T00:10:00.000Z',
      resolvedAt: '2026-02-10T00:02:00.000Z',
      answersHash: 'hash-a',
      submissionIds: new Set(['sub-1']),
    }

    const same = transitionInputSubmit({
      state: submittedState,
      nowIso: '2026-02-10T00:03:00.000Z',
      answersHash: 'hash-a',
      submissionId: 'sub-1',
    })
    expect(same.accepted).toBe(true)
    expect(same.submitStatus).toBe('already_submitted_same')

    const conflict = transitionInputSubmit({
      state: submittedState,
      nowIso: '2026-02-10T00:03:00.000Z',
      answersHash: 'hash-b',
      submissionId: 'sub-2',
    })
    expect(conflict.accepted).toBe(false)
    expect(conflict.submitStatus).toBe('conflict_already_submitted')

    const sameIdConflict = transitionInputSubmit({
      state: submittedState,
      nowIso: '2026-02-10T00:03:00.000Z',
      answersHash: 'hash-b',
      submissionId: 'sub-1',
    })
    expect(sameIdConflict.accepted).toBe(false)
    expect(sameIdConflict.submitStatus).toBe('conflict_already_submitted')
  })

  it('resolves pending to canceled/failed/expired', () => {
    const canceled = transitionResolvePending({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      status: 'canceled',
      resolvedAt: '2026-02-10T00:05:00.000Z',
      reason: 'turn_interrupted',
    })
    expect(canceled.status).toBe('canceled')
    if (canceled.status !== 'canceled') {
      throw new Error('expected canceled state')
    }
    expect(canceled.reason).toBe('turn_interrupted')
  })

  it('can hydrate submitted state from pending for remote resolved event', () => {
    const submitted = transitionResolvedFromPending({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      status: 'submitted',
      resolvedAt: '2026-02-10T00:01:00.000Z',
    })
    expect(submitted.status).toBe('submitted')
    expect(submitted.resolvedAt).toBe('2026-02-10T00:01:00.000Z')
  })

  it('resolves non-submitted pending state without optional reason', () => {
    const failed = transitionResolvedFromPending({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      status: 'failed',
      resolvedAt: '2026-02-10T00:01:00.000Z',
    })
    expect(failed.status).toBe('failed')
    expect(failed.reason).toBeUndefined()
    expect(Array.from(failed.submissionIds ?? [])).toEqual([])
  })

  it('treats remotely submitted pending input as already-locked for local re-submit', () => {
    const submitted = transitionResolvedFromPending({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      status: 'submitted',
      resolvedAt: '2026-02-10T00:01:00.000Z',
    })

    const out = transitionInputSubmit({
      state: submitted,
      nowIso: '2026-02-10T00:02:00.000Z',
      answersHash: 'hash-local',
      submissionId: 'sub-local',
    })

    expect(out.accepted).toBe(false)
    expect(out.submitStatus).toBe('conflict_already_submitted')
  })

  it('accepts repeated submission with same answers but new submission id', () => {
    const submittedState = {
      status: 'submitted' as const,
      createdAt: '2026-02-10T00:00:00.000Z',
      expiresAt: '2026-02-10T00:10:00.000Z',
      resolvedAt: '2026-02-10T00:02:00.000Z',
      answersHash: 'hash-a',
      submissionIds: new Set(['sub-1']),
    }

    const out = transitionInputSubmit({
      state: submittedState,
      nowIso: '2026-02-10T00:03:00.000Z',
      answersHash: 'hash-a',
      submissionId: 'sub-2',
    })
    expect(out.accepted).toBe(true)
    expect(out.submitStatus).toBe('already_submitted_same')
    if (out.nextState.status !== 'submitted') throw new Error('expected submitted state')
    expect(Array.from(out.nextState.submissionIds ?? []).sort()).toEqual(['sub-1', 'sub-2'])
  })

  it('handles submitted states without submission ids and no submission id input', () => {
    const first = transitionInputSubmit({
      state: {
        status: 'pending',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
      },
      nowIso: '2026-02-10T00:03:00.000Z',
      answersHash: 'hash-a',
    })
    expect(first.accepted).toBe(true)
    if (first.nextState.status !== 'submitted') throw new Error('expected submitted state')
    expect(Array.from(first.nextState.submissionIds ?? [])).toEqual([])

    const sameHash = transitionInputSubmit({
      state: {
        status: 'submitted',
        createdAt: first.nextState.createdAt,
        expiresAt: first.nextState.expiresAt,
        resolvedAt: first.nextState.resolvedAt,
        answersHash: 'hash-a',
      },
      nowIso: '2026-02-10T00:04:00.000Z',
      answersHash: 'hash-a',
    })
    expect(sameHash.accepted).toBe(true)
    expect(sameHash.submitStatus).toBe('already_submitted_same')
    if (sameHash.nextState.status !== 'submitted') throw new Error('expected submitted state')
    expect(Array.from(sameHash.nextState.submissionIds ?? [])).toEqual([])
  })

  it('returns terminal statuses for expired/canceled/not_pending states', () => {
    const expired = transitionInputSubmit({
      state: {
        status: 'expired',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
        resolvedAt: '2026-02-10T00:11:00.000Z',
        reason: 'input_expired',
      },
      nowIso: '2026-02-10T00:12:00.000Z',
      answersHash: 'hash-a',
    })
    expect(expired.submitStatus).toBe('expired')

    const canceled = transitionInputSubmit({
      state: {
        status: 'canceled',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
        resolvedAt: '2026-02-10T00:11:00.000Z',
        reason: 'turn_interrupted',
      },
      nowIso: '2026-02-10T00:12:00.000Z',
      answersHash: 'hash-a',
    })
    expect(canceled.submitStatus).toBe('canceled')

    const notPending = transitionInputSubmit({
      state: {
        status: 'failed',
        createdAt: '2026-02-10T00:00:00.000Z',
        expiresAt: '2026-02-10T00:10:00.000Z',
        resolvedAt: '2026-02-10T00:11:00.000Z',
      },
      nowIso: '2026-02-10T00:12:00.000Z',
      answersHash: 'hash-a',
    } as any)
    expect(notPending.submitStatus).toBe('not_pending')
  })

  it('does not resolve non-pending state in transitionResolvePending', () => {
    const state = {
      status: 'expired' as const,
      createdAt: '2026-02-10T00:00:00.000Z',
      expiresAt: '2026-02-10T00:10:00.000Z',
      resolvedAt: '2026-02-10T00:11:00.000Z',
      reason: 'input_expired',
    }
    const out = transitionResolvePending({
      state,
      status: 'canceled',
      resolvedAt: '2026-02-10T00:12:00.000Z',
      reason: 'ignored',
    })
    expect(out).toBe(state)
  })
})
