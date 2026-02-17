import { describe, expect, it } from 'vitest'
import { createInitialTranscriptProjectionState } from '../features/semantics/projection/transcriptProjection'
import { createInitialThreadRuntimeState } from './threadStateReducer'
import { buildReplayStateSnapshot } from './replayStateSnapshot'

describe('buildReplayStateSnapshot', () => {
  it('returns null when runtime state is missing', () => {
    expect(
      buildReplayStateSnapshot({
        stateForSnapshot: null,
        projection: null,
        includeProjectionSnapshot: false,
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
    })
    expect(withProjection).toEqual(
      expect.objectContaining({
        pendingInputCount: 1,
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
    })
    expect(withoutProjection).toEqual(
      expect.objectContaining({
        projection: null,
        invariantIssues: expect.arrayContaining([
          expect.objectContaining({ kind: 'running_tool_after_terminal_turn' }),
          expect.objectContaining({ kind: 'pending_input_after_terminal_turn' }),
        ]),
      }),
    )
  })
})
