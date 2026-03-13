import { describe, expect, it } from 'vitest'
import type { TranscriptProjectionState, TranscriptSegment } from '../projection/transcriptProjection'
import { createInitialTranscriptProjectionState } from '../projection/transcriptProjection'
import {
  createInitialThreadRuntimeState,
  type ThreadRuntimePendingInput,
  type ThreadRuntimeState,
} from '../runtime/threadRuntimeState'
import { selectTerminalTurnInvariantIssues, summarizeInvariantIssues } from './invariants'

function createProjection(segments: TranscriptSegment[]): TranscriptProjectionState {
  return {
    ...createInitialTranscriptProjectionState({ threadId: 'thread-1' }),
    segments,
  }
}

function createRuntimeState(pendingInputs: ThreadRuntimePendingInput[] = []): ThreadRuntimeState {
  const state = createInitialThreadRuntimeState({
    threadId: 'thread-1',
    replaySeq: 1,
    method: 'turn/started',
    ts: '2026-02-17T00:00:00.000Z',
  })
  const byId: Record<string, ThreadRuntimePendingInput> = {}
  for (const input of pendingInputs) byId[input.inputId] = input
  return {
    ...state,
    pendingInputs: byId,
  }
}

describe('selectTerminalTurnInvariantIssues', () => {
  it('reports running tool rows under terminal turns', () => {
    const projection = createProjection([
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
    ])

    expect(selectTerminalTurnInvariantIssues({ projection })).toEqual([
      {
        kind: 'running_tool_after_terminal_turn',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
      },
    ])
  })

  it('reports pending input leak under terminal turns for both approval and ask_user_question kinds', () => {
    const projection = createProjection([
      {
        id: 'footer-1',
        kind: 'turn_footer',
        turnId: 'turn-2',
        status: 'failed',
      },
    ])
    const runtimeState = createRuntimeState([
      {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-2',
        toolUseId: 'tool-2',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-17T00:00:01.000Z',
        expiresAt: '2026-02-17T00:05:01.000Z',
        payload: {},
      },
      {
        inputId: 'input-2',
        threadId: 'thread-1',
        turnId: 'turn-2',
        toolUseId: 'tool-3',
        kind: 'ask_user_question',
        status: 'pending',
        createdAt: '2026-02-17T00:00:02.000Z',
        expiresAt: '2026-02-17T00:05:02.000Z',
        payload: {},
      },
    ])

    expect(selectTerminalTurnInvariantIssues({ projection, runtimeState })).toEqual([
      {
        kind: 'pending_input_after_terminal_turn',
        turnId: 'turn-2',
        inputId: 'input-1',
        toolUseId: 'tool-2',
      },
      {
        kind: 'pending_input_after_terminal_turn',
        turnId: 'turn-2',
        inputId: 'input-2',
        toolUseId: 'tool-3',
      },
    ])
  })

  it('returns empty when terminal invariants hold', () => {
    const projection = createProjection([
      {
        id: 'tool-1',
        kind: 'tool',
        turnId: 'turn-3',
        toolUseId: 'tool-3',
        toolName: 'Read',
        status: 'completed',
        summary: 'done',
        detailLines: [],
      },
      {
        id: 'footer-1',
        kind: 'turn_footer',
        turnId: 'turn-3',
        status: 'completed',
      },
    ])
    const runtimeState = createRuntimeState()

    expect(selectTerminalTurnInvariantIssues({ projection, runtimeState })).toEqual([])
  })

  it('returns empty for null projection and filters non-terminal/non-pending rows', () => {
    expect(selectTerminalTurnInvariantIssues({ projection: null, runtimeState: createRuntimeState() })).toEqual([])

    const noFooterProjection = createProjection([
      {
        id: 'tool-open',
        kind: 'tool',
        turnId: 'turn-open',
        toolUseId: 'tool-open',
        toolName: 'Read',
        status: 'running',
        summary: 'still running',
        detailLines: [],
      },
    ])
    expect(selectTerminalTurnInvariantIssues({ projection: noFooterProjection, runtimeState: createRuntimeState() })).toEqual([])

    const terminalProjection = createProjection([
      {
        id: 'footer-terminal',
        kind: 'turn_footer',
        turnId: 'turn-terminal',
        status: 'completed',
      },
      {
        id: 'tool-non-terminal',
        kind: 'tool',
        turnId: 'turn-other',
        toolUseId: 'tool-other',
        toolName: 'Read',
        status: 'running',
        summary: 'running elsewhere',
        detailLines: [],
      },
    ])
    const runtimeState = createRuntimeState([
      {
        inputId: 'pending-other-turn',
        threadId: 'thread-1',
        turnId: 'turn-other',
        toolUseId: 'tool-y',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-17T00:00:02.000Z',
        expiresAt: '2026-02-17T00:05:02.000Z',
        payload: {},
      },
    ])
    expect(selectTerminalTurnInvariantIssues({ projection: terminalProjection, runtimeState })).toEqual([])
  })

  it('ignores non-pending-like runtime entries even if they match a terminal turn', () => {
    const projection = createProjection([
      {
        id: 'footer-terminal',
        kind: 'turn_footer',
        turnId: 'turn-terminal',
        status: 'completed',
      },
    ])
    const runtimeState = createRuntimeState([
      {
        inputId: 'resolved-like',
        threadId: 'thread-1',
        turnId: 'turn-terminal',
        toolUseId: 'tool-z',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-17T00:00:02.000Z',
        expiresAt: '2026-02-17T00:05:02.000Z',
        payload: {},
      },
    ])
    ;(runtimeState.pendingInputs['resolved-like'] as any).status = 'canceled'

    expect(selectTerminalTurnInvariantIssues({ projection, runtimeState })).toEqual([])
  })
})

describe('summarizeInvariantIssues', () => {
  it('aggregates issue counts by kind in stable order', () => {
    expect(
      summarizeInvariantIssues([
        { kind: 'pending_input_after_terminal_turn', turnId: 't1', inputId: 'i1', toolUseId: 'u1' },
        { kind: 'running_tool_after_terminal_turn', turnId: 't1', toolUseId: 'u2' },
        { kind: 'pending_input_after_terminal_turn', turnId: 't2', inputId: 'i2', toolUseId: 'u3' },
      ]),
    ).toBe('running_tool_after_terminal_turn=1, pending_input_after_terminal_turn=2')
  })

  it('returns none for empty issues', () => {
    expect(summarizeInvariantIssues([])).toBe('none')
  })
})
