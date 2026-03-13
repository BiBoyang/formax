import { describe, expect, it } from 'vitest'
import { createInitialTranscriptProjectionState } from '@formax/semantics'
import { createInitialThreadRuntimeState } from './threadStateReducer'
import { buildReplayStateSnapshot } from './replayStateSnapshot'

describe('buildReplayStateSnapshot', () => {
  it('returns null when runtime state is missing', () => {
    expect(
      buildReplayStateSnapshot({
        stateForSnapshot: null,
        projection: null,
        includeProjectionSnapshot: false,
        canonicalProtocolAnomalyCount: 0,
      }),
    ).toBeNull()
  })

  it('builds snapshot with invariant issues and optional projection snapshot', () => {
    const projection = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    projection.segments = [
      {
        id: 'tool-1',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'running',
        summary: 'Bash running',
        detailLines: [],
      },
      {
        id: 'footer-1',
        kind: 'turn_footer',
        turnId: 'turn-1',
        status: 'completed',
      },
    ]
    projection.toolNameByUseId = { 'tool-1': 'Bash' }

    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-17T00:00:00.000Z',
    })
    state.pendingInputs = {
      'input-1': {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-17T00:00:01.000Z',
        expiresAt: '2026-02-17T00:05:01.000Z',
        payload: {},
      },
    }
    state.lastTurnId = 'turn-1'
    state.lastTurnStatus = 'completed'
    state.activeTurnId = null

    const withProjection = buildReplayStateSnapshot({
      stateForSnapshot: state,
      projection,
      includeProjectionSnapshot: true,
      canonicalProtocolAnomalyCount: 2,
    })
    expect(withProjection).toEqual(
      expect.objectContaining({
        pendingInputCount: 1,
        canonicalProtocolAnomalyCount: 2,
        projection: expect.objectContaining({
          segments: expect.any(Array),
        }),
        invariantIssues: expect.arrayContaining([
          expect.objectContaining({ kind: 'running_tool_after_terminal_turn' }),
          expect.objectContaining({ kind: 'pending_input_after_terminal_turn' }),
        ]),
      }),
    )

    const withoutProjection = buildReplayStateSnapshot({
      stateForSnapshot: state,
      projection,
      includeProjectionSnapshot: false,
      canonicalProtocolAnomalyCount: 2,
    })
    expect(withoutProjection).toEqual(
      expect.objectContaining({
        projection: null,
        canonicalProtocolAnomalyCount: 2,
        invariantIssues: expect.arrayContaining([
          expect.objectContaining({ kind: 'running_tool_after_terminal_turn' }),
          expect.objectContaining({ kind: 'pending_input_after_terminal_turn' }),
        ]),
      }),
    )
  })

  it('returns empty invariantIssues when projection is null and includeProjectionSnapshot is false', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-17T00:00:00.000Z',
    })
    state.pendingInputs = {
      'input-1': {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-17T00:00:01.000Z',
        expiresAt: '2026-02-17T00:05:01.000Z',
        payload: {},
      },
    }
    const snapshot = buildReplayStateSnapshot({
      stateForSnapshot: state,
      projection: null,
      includeProjectionSnapshot: false,
      canonicalProtocolAnomalyCount: 0,
    })

    expect(snapshot).toEqual(
      expect.objectContaining({
        projection: null,
        pendingInputCount: 1,
        canonicalProtocolAnomalyCount: 0,
        invariantIssues: [],
      }),
    )
  })

  it('returns empty invariantIssues when projection is null and includeProjectionSnapshot is true', () => {
    const state = createInitialThreadRuntimeState({
      threadId: 'thread-1',
      replaySeq: 1,
      method: 'turn/started',
      ts: '2026-02-17T00:00:00.000Z',
    })
    const snapshot = buildReplayStateSnapshot({
      stateForSnapshot: state,
      projection: null,
      includeProjectionSnapshot: true,
      canonicalProtocolAnomalyCount: -3,
    })

    expect(snapshot).toEqual(
      expect.objectContaining({
        projection: null,
        canonicalProtocolAnomalyCount: 0,
        invariantIssues: [],
      }),
    )
  })
})
