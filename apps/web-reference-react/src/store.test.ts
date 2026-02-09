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

  it('merges thinking deltas into one collapsible transcript block', () => {
    let state = appReducer(initialAppState, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: 'Need to inspect files. ',
    })

    state = appReducer(state, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: 'Then propose patch.',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'thinking',
      turnId: 'turn-1',
      text: 'Need to inspect files. Then propose patch.',
    })
  })

  it('clears finalized turn thinking rows while keeping other transcript items', () => {
    const state = appReducer(initialAppState, {
      type: 'replace_logs',
      logs: [
        { id: 'thinking-1', kind: 'thinking', turnId: 'turn-1', text: 'working' },
        { id: 'assistant-1', kind: 'message', role: 'assistant', turnId: 'turn-1', text: 'done' },
        { id: 'thinking-2', kind: 'thinking', turnId: 'turn-2', text: 'still running' },
      ],
    })

    const finalized = appReducer(state, {
      type: 'finalize_turn_thinking',
      turnId: 'turn-1',
    })

    expect(finalized.logs).toEqual([
      { id: 'assistant-1', kind: 'message', role: 'assistant', turnId: 'turn-1', text: 'done' },
      { id: 'thinking-2', kind: 'thinking', turnId: 'turn-2', text: 'still running' },
    ])
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

  it('coalesces tool events into a single tool_call transcript row', () => {
    let state = appReducer(initialAppState, {
      type: 'append_tool_event',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      phase: 'start',
      input: { command: 'npm run type-check' },
    })

    state = appReducer(state, {
      type: 'append_tool_event',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'update',
      text: 'update',
    })

    state = appReducer(state, {
      type: 'append_tool_event',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'end',
      text: 'Ran command for 3s',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'Bash',
      status: 'completed',
      summary: 'Ran command for 3s',
    })
    const tool = state.logs[0] as any
    expect(tool.paramsText).toContain('command=')
    expect(tool.detailLines).toContain('update')
  })

  it('replaces transcript logs when loading thread history', () => {
    let state = appReducer(initialAppState, {
      type: 'push_message',
      role: 'assistant',
      text: 'old',
    })

    state = appReducer(state, {
      type: 'replace_logs',
      logs: [{ id: 'history-1', kind: 'message', role: 'assistant', text: 'from history' }],
    })

    expect(state.logs).toEqual([{ id: 'history-1', kind: 'message', role: 'assistant', text: 'from history' }])
  })

  it('prepends older transcript logs when loading earlier history pages', () => {
    let state = appReducer(initialAppState, {
      type: 'replace_logs',
      logs: [{ id: 'recent', kind: 'message', role: 'assistant', text: 'newer' }],
    })

    state = appReducer(state, {
      type: 'prepend_logs',
      logs: [{ id: 'older', kind: 'message', role: 'user', text: 'older' }],
    })

    expect(state.logs.map((item) => item.id)).toEqual(['older', 'recent'])
  })

  it('clears pending inputs when switching thread context', () => {
    const input = createPendingInput()
    let state = appReducer(initialAppState, { type: 'input_requested', input })
    expect(Object.keys(state.pendingInputs)).toHaveLength(1)

    state = appReducer(state, { type: 'clear_pending_inputs' })
    expect(state.pendingInputs).toEqual({})
    expect(state.selectedInputId).toBeNull()
  })
})
