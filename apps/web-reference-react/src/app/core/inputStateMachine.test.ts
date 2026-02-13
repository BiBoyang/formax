import { describe, expect, it } from 'vitest'
import {
  buildAskUiStateFromPendingInputs,
  mapsAreShallowEqual,
  pruneMapByPendingIds,
  resolveSelectedInputId,
  toPendingInputIdSet,
} from './inputStateMachine'
import type { PendingInput } from '../../types'

function pendingApproval(inputId: string): PendingInput {
  return {
    inputId,
    threadId: 'thread-1',
    turnId: 'turn-1',
    toolUseId: `tool-${inputId}`,
    kind: 'approval',
    status: 'pending',
    createdAt: '2026-02-10T00:00:00.000Z',
    expiresAt: '2026-02-10T00:05:00.000Z',
    payload: {},
  }
}

function pendingAsk(inputId: string): PendingInput {
  return {
    ...pendingApproval(inputId),
    kind: 'ask_user_question',
  }
}

describe('inputStateMachine', () => {
  it('selects last pending input when current selected is missing', () => {
    expect(resolveSelectedInputId({ pendingInputsById: {}, selectedInputId: null })).toBeNull()
    expect(
      resolveSelectedInputId({
        pendingInputsById: { a: pendingApproval('a'), b: pendingApproval('b') },
        selectedInputId: null,
      }),
    ).toBe('b')
  })

  it('prunes per-input maps and compares shallow equality', () => {
    const pendingIdSet = toPendingInputIdSet({ a: pendingApproval('a') })
    const next = pruneMapByPendingIds({ a: 1, b: 2 }, pendingIdSet)
    expect(next).toEqual({ a: 1 })
    expect(mapsAreShallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(mapsAreShallowEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('builds ask-ui maps from ask_user_question inputs while preserving drafts', () => {
    const built = buildAskUiStateFromPendingInputs({
      pendingInputs: [pendingApproval('a'), pendingAsk('b')],
      prevAskDockOpenByInputId: { b: false },
      prevAskDraftByInputId: { b: { q1: 'x' } },
      prevAskPageIndexByInputId: { b: 2 },
    })

    expect(built.askDockOpenByInputId).toEqual({ b: false })
    expect(built.askDraftByInputId).toEqual({ b: { q1: 'x' } })
    expect(built.askPageIndexByInputId).toEqual({ b: 2 })
  })
})
