import { describe, expect, it } from 'vitest'
import { TurnInputStore } from './inputStore.js'

describe('TurnInputStore', () => {
  it('creates pending input and supports idempotent/conflict submission states', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1', defaultInputTtlMs: 60_000 })
    const requested = store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: {
        questions: [
          {
            question: 'Pick one',
            header: 'Choice',
            options: [{ label: 'A', description: 'Option A' }],
            multiSelect: false,
          },
        ],
      },
    })
    expect(store.resolveInputIdFromToolUseId('ask-1')).toBe(requested.inputId)
    expect(store.resolveInputIdFromToolUseId('missing')).toBeNull()
    expect(store.hasInput(requested.inputId)).toBe(true)
    expect(store.hasInput('missing')).toBe(false)
    expect(store.submitInput({ inputId: 'missing', answers: {} })).toEqual({ accepted: false, status: 'not_pending' })

    const first = store.submitInput({
      inputId: requested.inputId,
      answers: { Choice: 'A' },
      submissionId: 'sub-1',
    })
    expect(first.accepted).toBe(true)
    expect(first.status).toBe('accepted')
    expect(first.transition?.status).toBe('submitted')

    const sameSubmission = store.submitInput({
      inputId: requested.inputId,
      answers: { Choice: 'A' },
      submissionId: 'sub-1',
    })
    expect(sameSubmission).toEqual({ accepted: true, status: 'already_submitted_same' })

    const sameAnswers = store.submitInput({
      inputId: requested.inputId,
      answers: { Choice: 'A' },
      submissionId: 'sub-2',
    })
    expect(sameAnswers.accepted).toBe(true)
    expect(sameAnswers.status).toBe('already_submitted_same')

    const conflict = store.submitInput({
      inputId: requested.inputId,
      answers: { Choice: 'B' },
      submissionId: 'sub-3',
    })
    expect(conflict).toEqual({ accepted: false, status: 'conflict_already_submitted' })
  })

  it('returns expired for stale pending input and emits transition', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1', defaultInputTtlMs: 1_000 })
    const requested = store.createPendingInput({
      toolUseId: 'ask-2',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })

    const expired = store.submitInput({
      inputId: requested.inputId,
      answers: { Choice: 'A' },
      now: new Date(Date.parse(requested.expiresAt) + 100).toISOString(),
    })
    expect(expired.accepted).toBe(false)
    expect(expired.status).toBe('expired')
    expect(expired.transition?.status).toBe('expired')
  })

  it('resolves all pending and reports canceled for later submit', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1', defaultInputTtlMs: 60_000 })
    const requested = store.createPendingInput({
      toolUseId: 'approval-1',
      kind: 'approval',
      payload: {
        toolName: 'Bash',
        action: { kind: 'bash.exec' },
        effectiveDecision: { decision: 'ask' },
      },
    })

    const resolved = store.resolveAllPending({ status: 'canceled', reason: 'turn_interrupted' })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.status).toBe('canceled')
    expect(resolved[0]?.inputId).toBe(requested.inputId)

    const canceled = store.submitInput({
      inputId: requested.inputId,
      answers: { decision: 'approve' },
    })
    expect(canceled).toEqual({ accepted: false, status: 'canceled' })
    expect(store.resolveInputIdFromToolUseId('approval-1')).toBe(requested.inputId)
  })

  it('returns latest tracked input id when tool-use mapping contains stale records', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1' })
    ;(store as any).inputIdByToolUseId.set('ghost-tool', ['ghost-input'])
    expect(store.resolveInputIdFromToolUseId('ghost-tool')).toBe('ghost-input')
  })

  it('suffixes input ids on collisions', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1' })
    const first = store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })
    const second = store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })
    expect(first.inputId).toBe('turn-1:ask-1:ask_user_question')
    expect(second.inputId).toBe('turn-1:ask-1:ask_user_question:2')
  })

  it('rejects new pending input when max pending limit is reached', () => {
    const store = new TurnInputStore({ threadId: 'thread-1', turnId: 'turn-1', maxPendingInputs: 1 })
    store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })

    expect(() =>
      store.createPendingInput({
        toolUseId: 'ask-2',
        kind: 'ask_user_question',
        payload: { questions: [] },
      }),
    ).toThrow('Pending input limit exceeded')
  })

  it('falls back to default limits and resolves pending inputs without reason', () => {
    const store = new TurnInputStore({
      threadId: 'thread-1',
      turnId: 'turn-1',
      defaultInputTtlMs: 0,
      maxPendingInputs: 0,
    })
    store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })
    store.createPendingInput({
      toolUseId: 'ask-2',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })

    const resolved = store.resolveAllPending({ status: 'canceled' })
    expect(resolved).toHaveLength(2)
    expect(resolved[0]?.reason).toBeUndefined()
  })

  it('does not count resolved records as pending when enforcing limits', () => {
    const store = new TurnInputStore({
      threadId: 'thread-1',
      turnId: 'turn-1',
      maxPendingInputs: 1,
    })
    const first = store.createPendingInput({
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      payload: { questions: [] },
    })
    store.submitInput({
      inputId: first.inputId,
      answers: { q: 'a' },
      submissionId: 'sub-1',
    })

    const skipped = store.resolveAllPending({ status: 'canceled', reason: 'none' })
    expect(skipped).toEqual([])

    expect(() =>
      store.createPendingInput({
        toolUseId: 'ask-2',
        kind: 'ask_user_question',
        payload: { questions: [] },
      }),
    ).not.toThrow()
  })
})
