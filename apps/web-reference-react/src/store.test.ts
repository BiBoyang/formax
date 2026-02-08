import { describe, expect, it } from 'vitest'
import { appReducer, initialAppState } from './store'
import type { PendingInput } from './types'

function createPendingInput(overrides: Partial<PendingInput> = {}): PendingInput {
  return {
    inputId: 'input-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    toolUseId: 'tool-1',
    kind: 'approval',
    status: 'pending',
    createdAt: '2026-02-09T00:00:00.000Z',
    expiresAt: '2026-02-09T00:05:00.000Z',
    payload: {
      toolName: 'Bash',
      action: { kind: 'bash.exec' },
      effectiveDecision: { decision: 'ask' },
    },
    ...overrides,
  }
}

describe('appReducer', () => {
  it('merges assistant delta into the same assistant message', () => {
    let state = appReducer(initialAppState, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'Hel',
    })

    state = appReducer(state, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'lo',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'Hello' })
  })

  it('tracks input requested -> resolved and clears selected input', () => {
    const input = createPendingInput()

    let state = appReducer(initialAppState, { type: 'input_requested', input })
    expect(state.pendingInputs[input.inputId]).toBeDefined()
    expect(state.selectedInputId).toBe(input.inputId)

    state = appReducer(state, {
      type: 'input_resolved',
      inputId: input.inputId,
      status: 'submitted',
    })

    expect(state.pendingInputs[input.inputId]).toBeUndefined()
    expect(state.selectedInputId).toBeNull()
    const lastLog = state.logs[state.logs.length - 1]
    expect(lastLog).toMatchObject({ kind: 'log', text: 'Input resolved: submitted' })
  })
})
