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
})
