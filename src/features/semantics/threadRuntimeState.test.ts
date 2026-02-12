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
})
