import { describe, expect, it } from 'vitest'
import {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
} from './threadRuntimeState.js'

describe('threadRuntimeState (shared)', () => {
  it('extracts threadId from params.threadId or params.turn.threadId', () => {
    expect(extractThreadIdFromNotificationParams({ threadId: 'thread-1' })).toBe('thread-1')
    expect(extractThreadIdFromNotificationParams({ turn: { threadId: 'thread-2' } })).toBe('thread-2')
    expect(extractThreadIdFromNotificationParams({})).toBeNull()
  })

  it('tracks turn lifecycle and pending input transitions', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/started',
      replaySeq: 2,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', status: 'running', mode: 'plan' },
      },
    })
    expect(state.mode).toBe('plan')
    expect(state.activeTurnId).toBe('turn-1')
    expect(state.lastTurnStatus).toBe('running')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 3,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        input: {
          inputId: 'input-1',
          turnId: 'turn-1',
          kind: 'approval',
          createdAt: '2026-02-10T00:00:01.000Z',
          expiresAt: '2026-02-10T00:05:01.000Z',
        },
      },
    })
    expect(Object.keys(state.pendingInputs)).toEqual(['input-1'])

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputResolved',
      replaySeq: 4,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        input: { inputId: 'input-1', status: 'submitted' },
      },
    })
    expect(state.pendingInputs).toEqual({})

    state = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 5,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', status: 'completed' },
      },
    })
    expect(state.activeTurnId).toBeNull()
    expect(state.lastTurnId).toBe('turn-1')
    expect(state.lastTurnStatus).toBe('completed')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/modeChanged',
      replaySeq: 6,
      params: {
        threadId: 'thread-1',
        mode: 'acceptEdits',
      },
    })
    expect(state.mode).toBe('acceptEdits')
  })

  it('tracks sticky tool names from tool events and input payloads', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 2,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        event: {
          type: 'tool_start',
          id: 'tool-1',
          name: 'Bash',
        },
      },
    })

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 3,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        input: {
          inputId: 'input-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-2',
          kind: 'approval',
          status: 'pending',
          createdAt: '2026-02-10T00:00:01.000Z',
          expiresAt: '2026-02-10T00:05:01.000Z',
          payload: { toolName: 'Write', action: {}, effectiveDecision: {} },
        },
      },
    })

    expect(state.toolNameByUseId).toEqual({
      'tool-1': 'Bash',
      'tool-2': 'Write',
    })
  })

  it('bounds sticky tool name cache size and retains newest entries', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    for (let index = 0; index < 530; index += 1) {
      state = reduceThreadRuntimeState(state, {
        method: 'turn/event',
        replaySeq: 2 + index,
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          event: {
            type: 'tool_start',
            id: `tool-${index}`,
            name: `Tool${index}`,
          },
        },
      })
    }

    expect(Object.keys(state.toolNameByUseId)).toHaveLength(512)
    expect(state.toolNameByUseId['tool-0']).toBeUndefined()
    expect(state.toolNameByUseId['tool-17']).toBeUndefined()
    expect(state.toolNameByUseId['tool-529']).toBe('Tool529')
  })

  it('uses runtime thread fallback + inputId fallback for cross-end inputRequested payloads', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 2,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-legacy',
        input: {
          inputId: 'input-legacy',
          turnId: 'turn-legacy',
          kind: 'approval',
          createdAt: '2026-02-10T00:00:01.000Z',
          expiresAt: '2026-02-10T00:05:01.000Z',
        },
      },
    })

    expect(state.pendingInputs['input-legacy']).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-legacy',
      toolUseId: 'input-legacy',
      kind: 'approval',
      status: 'pending',
    })
  })

  it('enforces monotonic replaySeq and ignores duplicate/stale notifications', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 10,
      method: 'turn/event',
      ts: '2026-02-10T00:00:00.000Z',
    })
    expect(state.lastReplaySeq).toBe(9)

    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 10,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        event: {
          type: 'tool_start',
          id: 'tool-1',
          name: 'Bash',
        },
      },
    })
    expect(state.lastReplaySeq).toBe(10)
    expect(state.toolNameByUseId).toEqual({ 'tool-1': 'Bash' })

    const duplicate = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 10,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        event: {
          type: 'tool_start',
          id: 'tool-2',
          name: 'Write',
        },
      },
    })
    expect(duplicate).toBe(state)

    const stale = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 9,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        event: {
          type: 'tool_start',
          id: 'tool-3',
          name: 'Edit',
        },
      },
    })
    expect(stale).toBe(state)
    expect(stale.toolNameByUseId).toEqual({ 'tool-1': 'Bash' })
  })

  it('clears unresolved pending inputs for a turn when that turn reaches terminal state', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 2,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        input: {
          inputId: 'input-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'pending',
          createdAt: '2026-02-10T00:00:01.000Z',
          expiresAt: '2026-02-10T00:05:01.000Z',
          payload: {},
        },
      },
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 3,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        input: {
          inputId: 'input-2',
          threadId: 'thread-1',
          turnId: 'turn-2',
          toolUseId: 'tool-2',
          kind: 'approval',
          status: 'pending',
          createdAt: '2026-02-10T00:00:02.000Z',
          expiresAt: '2026-02-10T00:05:02.000Z',
          payload: {},
        },
      },
    })
    expect(Object.keys(state.pendingInputs)).toEqual(['input-1', 'input-2'])

    state = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 4,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', status: 'completed' },
      },
    })

    expect(Object.keys(state.pendingInputs)).toEqual(['input-2'])
  })

  it('falls back terminal status defaults and ignores unknown methods', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-10T00:00:00.000Z',
    })

    state = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 2,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', status: 'weird' },
      },
    })
    expect(state.lastTurnStatus).toBe('completed')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/failed',
      replaySeq: 3,
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-2', threadId: 'thread-1', status: 'weird' },
      },
    })
    expect(state.lastTurnStatus).toBe('failed')

    const next = reduceThreadRuntimeState(state, {
      method: 'turn/unknown' as any,
      replaySeq: 4,
      params: { threadId: 'thread-1' },
    })
    expect(next).not.toBe(state)
    expect(next.lastTurnStatus).toBe('failed')
  })

  it('handles invalid/minimal payloads across all reducers without mutating runtime invariants', () => {
    expect(extractThreadIdFromNotificationParams(null)).toBeNull()
    expect(extractThreadIdFromNotificationParams({ turn: { threadId: '   ' } })).toBeNull()

    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: Number.NaN,
      method: 'turn/bootstrap',
      ts: 'not-a-date',
    })
    expect(state.lastReplaySeq).toBe(0)
    expect(Number.isFinite(Date.parse(state.updatedAt))).toBe(true)

    state = reduceThreadRuntimeState(state, {
      method: 'turn/unknown' as any,
      replaySeq: 1,
      params: null,
    })
    expect(state.lastNotificationMethod).toBe('turn/unknown')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/started',
      replaySeq: 2,
      params: {},
    })
    expect(state.activeTurnId).toBeNull()

    state = reduceThreadRuntimeState(state, {
      method: 'turn/started',
      replaySeq: 3,
      params: {
        turn: {
          id: '   ',
          mode: 'invalid-mode',
        },
      },
    })
    expect(state.mode).toBe('normal')
    expect(state.lastTurnId).toBeNull()

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 4,
      params: {},
    })
    expect(state.pendingInputs).toEqual({})

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 5,
      params: {
        input: {
          inputId: 123,
          turnId: 456,
          toolUseId: '   ',
          kind: 'unknown-kind',
          createdAt: 1,
          expiresAt: 2,
          payload: { toolName: '   ' },
        },
      },
    })
    expect(state.pendingInputs).toEqual({})
    expect(state.toolNameByUseId).toEqual({})

    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputResolved',
      replaySeq: 6,
      params: {},
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputResolved',
      replaySeq: 7,
      params: {
        input: { inputId: 'missing-input' },
      },
    })
    expect(state.pendingInputs).toEqual({})

    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 8,
      params: {},
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 9,
      params: {
        event: { type: 'assistant_delta' },
      },
    })
    expect(state.toolNameByUseId).toEqual({})

    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 10,
      params: {
        event: {
          type: 'tool_start',
          id: 'tool-repeat',
          name: 'Repeat',
        },
      },
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 11,
      params: {
        event: {
          type: 'tool_start',
          id: 'tool-repeat',
          name: 'Repeat',
        },
      },
    })
    expect(state.toolNameByUseId['tool-repeat']).toBe('Repeat')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 12,
      params: {
        event: {
          type: 'tool_update',
          toolUseId: 'tool-fallback-id',
          toolName: 'FallbackName',
        },
      },
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 13,
      params: {
        event: {
          type: 'tool_end',
          id: 'tool-end-only',
        },
      },
    })
    state = reduceThreadRuntimeState(state, {
      method: 'turn/event',
      replaySeq: 14,
      params: {
        event: {
          type: 'tool_input',
          toolUseId: 'tool-input-only',
          toolName: 'InputTool',
        },
      },
    })
    expect(state.toolNameByUseId).toMatchObject({
      'tool-repeat': 'Repeat',
      'tool-fallback-id': 'FallbackName',
      'tool-input-only': 'InputTool',
    })
    expect(state.toolNameByUseId['tool-end-only']).toBeUndefined()

    state = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 15,
      params: {},
    })
    expect(state.lastTurnStatus).toBeNull()

    state = reduceThreadRuntimeState(state, {
      method: 'turn/completed',
      replaySeq: 16,
      params: {
        turn: {
          id: 123,
          status: 'completed',
        },
      },
    })
    expect(state.lastTurnId).toBeNull()
    expect(state.lastTurnStatus).toBe('completed')

    state = reduceThreadRuntimeState(state, {
      method: 'turn/modeChanged',
      replaySeq: 17,
      params: {
        mode: 'not-a-mode',
      },
    })
    expect(state.mode).toBe('normal')
  })

  it('defaults createdAt/expiresAt and params timestamp when payload fields are absent', () => {
    let state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/bootstrap',
      ts: '2026-02-10T00:00:00.000Z',
    })

    const before = Date.parse(state.updatedAt)
    state = reduceThreadRuntimeState(state, {
      method: 'turn/inputRequested',
      replaySeq: 2,
      params: {
        ts: null,
        input: {
          inputId: 'input-default-time',
          turnId: 'turn-default-time',
          kind: 'approval',
          createdAt: 1,
          expiresAt: null,
        },
      } as any,
    })

    const pending = state.pendingInputs['input-default-time']
    expect(pending).toBeDefined()
    expect(pending?.createdAt).toBeTypeOf('string')
    expect(pending?.expiresAt).toBe(pending?.createdAt)
    expect(Date.parse(state.updatedAt)).toBeGreaterThanOrEqual(before)
  })
})
