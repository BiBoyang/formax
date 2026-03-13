import { describe, expect, it } from 'vitest'
import { createInitialThreadRuntimeState, reduceThreadRuntimeState } from './threadRuntimeState'

describe('threadRuntimeState branch coverage guards', () => {
  it('returns same state for duplicate or stale replay sequences', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 5,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })
    const duplicate = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 4,
      params: {},
    })
    expect(duplicate).toBe(state)
  })

  it('handles terminal notifications with non-object turn payloads', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    const completed = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 2,
      params: { turn: null },
    })
    expect(completed.lastTurnStatus).toBeNull()

    const failed = reduceThreadRuntimeState(completed, {
      method: 'turn/failed',
      replaySeq: 3,
      params: { turn: 1 as any },
    })
    expect(failed.lastTurnStatus).toBeNull()
  })

  it('ignores invalid mode values for turn/modeChanged', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    const next = reduceThreadRuntimeState(state, {
      method: 'turn/modeChanged',
      replaySeq: 2,
      params: { mode: 'invalid-mode' },
    })
    expect(next.mode).toBe('normal')
  })

  it('ignores inputResolved events without valid matching input id', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    const invalidInput = reduceThreadRuntimeState(state, {
      method: 'turn/inputResolved',
      replaySeq: 2,
      params: { input: null },
    })
    expect(invalidInput.pendingInputs).toEqual({})

    const unknownInputId = reduceThreadRuntimeState(invalidInput, {
      method: 'turn/inputResolved',
      replaySeq: 3,
      params: { input: { inputId: 'missing-id' } },
    })
    expect(unknownInputId.pendingInputs).toEqual({})
  })

  it('handles completed events when turn id is missing', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    const out = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 2,
      params: { turn: { status: 'completed' } },
    })
    expect(out.lastTurnId).toBeNull()
    expect(out.lastTurnStatus).toBe('completed')
  })
})
