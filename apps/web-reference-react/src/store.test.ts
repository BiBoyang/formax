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

  it('keeps assistant deltas merged when thinking rows are interleaved', () => {
    let state = appReducer(initialAppState, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'Hel',
    })

    state = appReducer(state, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: 'draft',
    })

    state = appReducer(state, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'lo',
    })

    expect(state.logs).toHaveLength(2)
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'Hello' })
    expect(state.logs[1]).toMatchObject({ kind: 'thinking', text: 'draft' })
  })

  it('keeps assistant deltas merged across unscoped logs in the same tail', () => {
    let state = appReducer(initialAppState, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'Hel',
    })

    state = appReducer(state, {
      type: 'push_log',
      text: 'local status',
    })

    state = appReducer(state, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'lo',
    })

    expect(state.logs).toHaveLength(2)
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'Hello' })
    expect(state.logs[1]).toMatchObject({ kind: 'log', text: 'local status' })
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
      status: 'running',
    })
  })

  it('keeps thinking deltas merged when assistant rows are interleaved', () => {
    let state = appReducer(initialAppState, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: 'first',
    })

    state = appReducer(state, {
      type: 'append_assistant_delta',
      turnId: 'turn-1',
      text: 'answer',
    })

    state = appReducer(state, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: ' second',
    })

    expect(state.logs).toHaveLength(2)
    expect(state.logs[0]).toMatchObject({ kind: 'thinking', text: 'first second', status: 'running' })
    expect(state.logs[1]).toMatchObject({ kind: 'message', role: 'assistant', text: 'answer' })
  })

  it('does not reopen finalized thinking rows when late deltas arrive', () => {
    let state = appReducer(initialAppState, {
      type: 'replace_logs',
      logs: [{ id: 'thinking-1', kind: 'thinking', turnId: 'turn-1', text: 'done', status: 'finalized' }],
    })

    state = appReducer(state, {
      type: 'append_thinking_delta',
      turnId: 'turn-1',
      text: ' late',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'thinking',
      turnId: 'turn-1',
      text: 'done late',
      status: 'finalized',
    })
  })

  it('finalizes turn thinking rows while keeping other transcript items', () => {
    const state = appReducer(initialAppState, {
      type: 'replace_logs',
      logs: [
        { id: 'thinking-1', kind: 'thinking', turnId: 'turn-1', text: 'working', status: 'running' },
        { id: 'assistant-1', kind: 'message', role: 'assistant', turnId: 'turn-1', text: 'done' },
        { id: 'thinking-2', kind: 'thinking', turnId: 'turn-2', text: 'still running', status: 'running' },
      ],
    })

    const finalized = appReducer(state, {
      type: 'finalize_turn_thinking',
      turnId: 'turn-1',
    })

    expect(finalized.logs).toEqual([
      { id: 'thinking-1', kind: 'thinking', turnId: 'turn-1', text: 'working', status: 'finalized' },
      { id: 'assistant-1', kind: 'message', role: 'assistant', turnId: 'turn-1', text: 'done' },
      { id: 'thinking-2', kind: 'thinking', turnId: 'turn-2', text: 'still running', status: 'running' },
    ])
  })

  it('stores one turn footer per turn and updates status on repeat writes', () => {
    let state = appReducer(initialAppState, {
      type: 'push_turn_footer',
      turnId: 'turn-1',
      status: 'completed',
    })
    expect(state.logs.filter((item) => item.kind === 'turn_footer')).toHaveLength(1)

    state = appReducer(state, {
      type: 'push_turn_footer',
      turnId: 'turn-1',
      status: 'failed',
      message: 'error',
    })
    const footers = state.logs.filter((item) => item.kind === 'turn_footer')
    expect(footers).toHaveLength(1)
    expect(footers[0]).toMatchObject({ status: 'failed', message: 'error' })
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

  it('handles resolved metadata (resolvedAt/reason) without keeping stale pending rows', () => {
    const input = createPendingInput({ kind: 'ask_user_question' })
    let state = appReducer(initialAppState, { type: 'input_requested', input })
    expect(state.pendingInputs[input.inputId]).toBeDefined()

    state = appReducer(state, {
      type: 'input_resolved',
      inputId: input.inputId,
      status: 'failed',
      resolvedAt: '2026-02-09T00:01:00.000Z',
      reason: 'input_expired',
    })

    expect(state.pendingInputs[input.inputId]).toBeUndefined()
    const lastLog = state.logs[state.logs.length - 1]
    expect(lastLog).toMatchObject({ kind: 'log', text: 'Input resolved: failed' })
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

  it('annotates tool row with input lifecycle state', () => {
    let state = appReducer(initialAppState, {
      type: 'append_tool_event',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      phase: 'start',
    })

    state = appReducer(state, {
      type: 'annotate_tool_input_state',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      inputKind: 'approval',
      status: 'pending',
    })

    state = appReducer(state, {
      type: 'annotate_tool_input_state',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      inputKind: 'approval',
      status: 'submitted',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      toolUseId: 'tool-1',
      inputState: {
        kind: 'approval',
        status: 'submitted',
      },
    })
  })

  it('creates placeholder tool row when input state arrives before tool event', () => {
    const state = appReducer(initialAppState, {
      type: 'annotate_tool_input_state',
      turnId: 'turn-7',
      toolUseId: 'tool-late',
      toolName: 'Glob',
      inputKind: 'ask_user_question',
      status: 'pending',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      turnId: 'turn-7',
      toolUseId: 'tool-late',
      toolName: 'Glob',
      inputState: {
        kind: 'ask_user_question',
        status: 'pending',
      },
    })
  })

  it('updates tool name on existing row when annotation provides better metadata', () => {
    let state = appReducer(initialAppState, {
      type: 'append_tool_event',
      turnId: 'turn-9',
      toolUseId: 'tool-9',
      phase: 'start',
    })

    state = appReducer(state, {
      type: 'annotate_tool_input_state',
      turnId: 'turn-9',
      toolUseId: 'tool-9',
      toolName: 'Bash',
      inputKind: 'approval',
      status: 'pending',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      toolName: 'Bash',
      summary: 'Bash running',
      inputState: {
        kind: 'approval',
        status: 'pending',
      },
    })
  })

  it('reuses history tool row without turnId when annotating by toolUseId', () => {
    let state = appReducer(initialAppState, {
      type: 'replace_logs',
      logs: [
        {
          id: 'history-tool-1',
          kind: 'tool_call',
          toolUseId: 'tool-history-1',
          toolName: 'Read',
          status: 'completed',
          summary: 'Read file',
          detailLines: [],
        },
      ],
    })

    state = appReducer(state, {
      type: 'annotate_tool_input_state',
      turnId: 'turn-history',
      toolUseId: 'tool-history-1',
      inputKind: 'ask_user_question',
      status: 'submitted',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      turnId: 'turn-history',
      toolUseId: 'tool-history-1',
      inputState: {
        kind: 'ask_user_question',
        status: 'submitted',
      },
    })
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
