import { describe, expect, it, vi } from 'vitest'
import { replayThreadEvents, type ReplayThreadEventsContext } from './replayThreadEvents'
import type { ReplayStateSnapshot } from '../core/rpcParsers'

function createReplayState(overrides: Partial<ReplayStateSnapshot> = {}): ReplayStateSnapshot {
  return {
    mode: 'normal',
    activeTurnId: null,
    lastTurnId: null,
    lastTurnStatus: null,
    pendingInputCount: 0,
    pendingInputs: [],
    invariantIssues: [],
    projection: null,
    toolNameByUseId: {},
    updatedAt: '2026-02-17T00:00:00.000Z',
    ...overrides,
  }
}

function createBaseContext(overrides: Partial<ReplayThreadEventsContext> = {}): ReplayThreadEventsContext {
  return {
    request: vi.fn(),
    asThreadReplay: (value) => value as ReturnType<ReplayThreadEventsContext['asThreadReplay']>,
    toRuntimePendingInputsById: vi.fn().mockReturnValue({}),
    replayCursorByThreadRef: { current: { 'thread-1': 50 } },
    runtimeStateByThreadRef: { current: {} },
    activeThreadIdRef: { current: 'thread-1' },
    logsByThreadIdRef: { current: { 'thread-1': [{ id: 'cached-log' }] } },
    stateLogsRef: { current: [{ id: 'active-log' }] },
    transcriptSourceByThreadRef: { current: { 'thread-1': 'history' } },
    dispatch: vi.fn(),
    setMode: vi.fn(),
    cacheThreadMode: vi.fn(),
    setThreadTranscriptSource: vi.fn(),
    clearThreadHistoryCursor: vi.fn(),
    syncPendingInputsFromReplayState: vi.fn(),
    loadThreadHistory: vi.fn().mockResolvedValue(true),
    handleNotification: vi.fn(),
    log: vi.fn(),
    ...overrides,
  }
}

describe('replayThreadEvents', () => {
  it('uses replay-first rebuild on hasGap and clears cached logs', async () => {
    const gapState = createReplayState()
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: gapState,
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 120,
        latestCursor: 120,
        hasGap: false,
        state: gapState,
      })
    const ctx = createBaseContext({ request })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(request).toHaveBeenNthCalledWith(1, 'thread/replay', {
      threadId: 'thread-1',
      after: 50,
      limit: 200,
    })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: 'thread-1' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'replace_logs', logs: [] })
    expect(ctx.setThreadTranscriptSource).toHaveBeenCalledWith('thread-1', 'replay')
    expect(ctx.clearThreadHistoryCursor).toHaveBeenCalledWith('thread-1')
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(120)
    expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith('thread-1', gapState)
    expect(ctx.handleNotification).not.toHaveBeenCalled()
  })

  it('logs replay invariant issues once per replay request', async () => {
    const replayState = createReplayState({
      invariantIssues: [
        { kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' },
        { kind: 'pending_input_after_terminal_turn', turnId: 'turn-1', inputId: 'input-1', toolUseId: 'tool-1' },
      ],
    })
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ replaySeq: 51, method: 'turn/started', params: { replaySeq: 51 } }],
        nextCursor: 51,
        latestCursor: 51,
        hasGap: false,
        state: replayState,
      })
    const ctx = createBaseContext({ request })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(ctx.log).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith('Replay invariant issues detected (2)', 'warn')
  })
})
