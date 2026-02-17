import { describe, expect, it } from 'vitest'
import { appReducer, initialAppState } from './store'
import type { PendingInput } from './types'
import type { CanonicalEvent } from '../../../src/features/semantics/core/canonicalEvents'

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

function createCanonicalEvent(
  base: { replaySeq: number; eventId: string },
  patch: { kind: CanonicalEvent['kind'] } & Record<string, unknown>,
): CanonicalEvent {
  return {
    threadId: 'thread-1',
    replaySeq: base.replaySeq,
    eventId: base.eventId,
    ts: '2026-02-13T01:10:00.000Z',
    source: 'engine',
    ...patch,
  } as CanonicalEvent
}

describe('appReducer', () => {
  it('binds turn id to the latest user message without turn id', () => {
    let state = appReducer(initialAppState, {
      type: 'push_message',
      role: 'user',
      text: 'hello',
    })

    state = appReducer(state, {
      type: 'bind_last_user_message_turn',
      turnId: 'turn-1',
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      text: 'hello',
      turnId: 'turn-1',
    })
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
    expect(state.logs[state.logs.length - 1]).toMatchObject({ kind: 'log', text: 'Input resolved: submitted' })
  })

  it('handles resolved metadata (resolvedAt/reason) without keeping stale pending rows', () => {
    const input = createPendingInput({ kind: 'ask_user_question' })
    let state = appReducer(initialAppState, { type: 'input_requested', input })

    state = appReducer(state, {
      type: 'input_resolved',
      inputId: input.inputId,
      status: 'failed',
      resolvedAt: '2026-02-09T00:01:00.000Z',
      reason: 'input_expired',
    })

    expect(state.pendingInputs[input.inputId]).toBeUndefined()
    expect(state.logs[state.logs.length - 1]).toMatchObject({ kind: 'log', text: 'Input resolved: failed' })
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

    state = appReducer(state, { type: 'clear_pending_inputs' })
    expect(state.pendingInputs).toEqual({})
    expect(state.selectedInputId).toBeNull()
  })

  it('applies canonical events without back-writing assistant text across tool rows', () => {
    let state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 1, eventId: 'e1' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'alpha' },
      ),
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 2, eventId: 'e2' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' },
      ),
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 3, eventId: 'e3' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'beta' },
      ),
    })

    expect(state.logs.map((item) => item.kind)).toEqual(['message', 'tool_call', 'message'])
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'alpha' })
    expect(state.logs[1]).toMatchObject({ kind: 'tool_call', toolName: 'Bash' })
    expect(state.logs[2]).toMatchObject({ kind: 'message', role: 'assistant', text: 'beta' })
  })

  it('deduplicates canonical events by eventId', () => {
    let state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 1, eventId: 'e-dup' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'hello' },
      ),
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 1, eventId: 'e-dup' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'hello' },
      ),
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'hello' })
  })

  it('hydrates projection tool names and applies sticky name for tool updates without toolName', () => {
    let state = appReducer(initialAppState, {
      type: 'hydrate_projection_tool_names',
      threadId: 'thread-1',
      toolNameByUseId: { 'tool-snap': 'Glob' },
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 4, eventId: 'tool-seeded' },
        { kind: 'tool_event', turnId: 'turn-2', toolUseId: 'tool-snap', phase: 'update', line: 'running' },
      ),
    })

    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      kind: 'tool_call',
      turnId: 'turn-2',
      toolUseId: 'tool-snap',
      toolName: 'Glob',
      detailLines: ['running'],
    })
  })

  it('hydrates projection snapshot into logs and projection state', () => {
    const state = appReducer(initialAppState, {
      type: 'hydrate_projection_snapshot',
      threadId: 'thread-1',
      snapshot: {
        segments: [
          {
            id: 'turn-1:assistant:1',
            kind: 'assistant',
            turnId: 'turn-1',
            text: 'hello',
          },
          {
            id: 'turn-1:turn_footer:2',
            kind: 'turn_footer',
            turnId: 'turn-1',
            status: 'completed',
          },
        ],
        lastReplaySeq: 2,
        toolNameByUseId: {},
        openAssistantSegmentIdByTurn: {},
        openThinkingSegmentIdByTurn: {},
      },
    })

    expect(state.logs).toHaveLength(2)
    expect(state.logs[0]).toMatchObject({ kind: 'message', role: 'assistant', text: 'hello', turnId: 'turn-1' })
    expect(state.logs[1]).toMatchObject({ kind: 'turn_footer', turnId: 'turn-1', status: 'completed' })
    expect(state.transcriptProjection).toMatchObject({
      threadId: 'thread-1',
      lastReplaySeq: 2,
    })
  })

  it('keeps turn footer createdAt stable when projection is rebuilt', () => {
    let state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 10, eventId: 'footer-1' },
        { kind: 'turn_footer', turnId: 'turn-1', status: 'completed' },
      ),
    })

    const firstFooter = state.logs.find((item) => item.kind === 'turn_footer')
    expect(firstFooter).toBeDefined()
    const firstCreatedAt = firstFooter?.kind === 'turn_footer' ? firstFooter.createdAt : ''

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 11, eventId: 'assistant-after-footer' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'late tail' },
      ),
    })

    const secondFooter = state.logs.find((item) => item.kind === 'turn_footer')
    expect(secondFooter).toBeDefined()
    if (!secondFooter || secondFooter.kind !== 'turn_footer') throw new Error('missing turn footer')
    expect(secondFooter).toMatchObject({ kind: 'turn_footer', turnId: 'turn-1', status: 'completed' })
    expect(secondFooter.createdAt).toBe(firstCreatedAt)
  })

  it('preserves turn-scoped log ordering when canonical projection expands', () => {
    let state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 20, eventId: 'assistant-first' },
        { kind: 'assistant_delta', turnId: 'turn-9', textDelta: 'alpha' },
      ),
    })

    state = appReducer(state, {
      type: 'push_log',
      turnId: 'turn-9',
      text: 'local marker',
      level: 'info',
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 21, eventId: 'tool-after-log' },
        { kind: 'tool_event', turnId: 'turn-9', toolUseId: 'tool-9', phase: 'start', toolName: 'Bash' },
      ),
    })

    expect(state.logs.map((item) => item.kind)).toEqual(['message', 'log', 'tool_call'])
    expect(state.logs[1]).toMatchObject({ kind: 'log', text: 'local marker', turnId: 'turn-9' })
  })

  it('normalizes Task tool summary for running/error rows via shared selector', () => {
    let state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 30, eventId: 'task-running' },
        { kind: 'tool_event', turnId: 'turn-task', toolUseId: 'task-1', phase: 'start', toolName: 'Task' },
      ),
    })

    state = appReducer(state, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 31, eventId: 'task-error' },
        {
          kind: 'tool_event',
          turnId: 'turn-task',
          toolUseId: 'task-1',
          phase: 'end',
          toolName: 'Task',
          summary: 'Error: timed out',
          isError: true,
        },
      ),
    })

    const taskRow = state.logs.find((item) => item.kind === 'tool_call' && item.toolUseId === 'task-1')
    expect(taskRow).toMatchObject({
      kind: 'tool_call',
      toolName: 'Task',
      status: 'error',
      summary: 'timed out',
    })
  })

  it('renders Task started summary from selector completion kind', () => {
    const state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 32, eventId: 'task-started' },
        {
          kind: 'tool_event',
          turnId: 'turn-task-started',
          toolUseId: 'task-2',
          phase: 'end',
          toolName: 'Task',
          summary: 'ok',
          result: '{"status":"running","task_id":"task_456"}',
          isError: false,
        },
      ),
    })

    const taskRow = state.logs.find((item) => item.kind === 'tool_call' && item.toolUseId === 'task-2')
    expect(taskRow).toMatchObject({
      kind: 'tool_call',
      toolName: 'Task',
      status: 'completed',
      summary: 'Started (task_id: task_456)',
    })
  })

  it('hides successful Skill tool summary via shared selector rule', () => {
    const state = appReducer(initialAppState, {
      type: 'apply_canonical_event',
      event: createCanonicalEvent(
        { replaySeq: 40, eventId: 'skill-ok' },
        {
          kind: 'tool_event',
          turnId: 'turn-skill',
          toolUseId: 'skill-1',
          phase: 'end',
          toolName: 'Skill',
          summary: 'ok',
          isError: false,
        },
      ),
    })

    const skillRow = state.logs.find((item) => item.kind === 'tool_call' && item.toolUseId === 'skill-1')
    expect(skillRow).toMatchObject({
      kind: 'tool_call',
      toolName: 'Skill',
      status: 'completed',
      summary: '',
    })
  })
})
