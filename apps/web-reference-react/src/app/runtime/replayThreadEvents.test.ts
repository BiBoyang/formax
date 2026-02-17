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
    canonicalProtocolAnomalyCount: 0,
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
    replayAnomalyCountSeenByThreadRef: { current: {} },
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
    expect(ctx.log).toHaveBeenCalledWith(
      'Replay invariant issues detected (running_tool_after_terminal_turn=1, pending_input_after_terminal_turn=1)',
      'warn',
    )
  })

  it('logs canonical protocol anomaly count once per replay request', async () => {
    const replayState = createReplayState({
      canonicalProtocolAnomalyCount: 3,
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
    expect(ctx.log).toHaveBeenCalledWith('Replay canonical protocol anomalies detected (count=3)', 'warn')
  })

  it('logs invariant issues once on hasGap projection hydration path', async () => {
    const gapState = createReplayState({
      invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' }],
      projection: {
        segments: [
          {
            id: 's1',
            kind: 'assistant',
            turnId: 'turn-1',
            text: 'rebuilt',
          },
        ],
        lastReplaySeq: 120,
        toolNameByUseId: {},
        openAssistantSegmentIdByTurn: {},
        openThinkingSegmentIdByTurn: {},
      },
    })
    const request = vi.fn().mockResolvedValueOnce({
      data: [],
      nextCursor: 50,
      latestCursor: 120,
      hasGap: true,
      state: gapState,
    })
    const ctx = createBaseContext({ request })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(ctx.log).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith('Replay invariant issues detected (running_tool_after_terminal_turn=1)', 'warn')
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'hydrate_projection_snapshot',
      threadId: 'thread-1',
      snapshot: gapState.projection,
    })
  })

  it('logs invariant issues once across hasGap baseline replay double-request path', async () => {
    const gapState = createReplayState({
      invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' }],
      projection: null,
    })
    const baselineState = createReplayState({
      invariantIssues: [
        { kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' },
        { kind: 'pending_input_after_terminal_turn', turnId: 'turn-1', inputId: 'input-1', toolUseId: 'tool-1' },
      ],
      projection: null,
    })
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
        state: baselineState,
      })
    const ctx = createBaseContext({ request })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    expect(ctx.log).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith('Replay invariant issues detected (running_tool_after_terminal_turn=1)', 'warn')
  })

  it('logs canonical protocol anomalies once across hasGap baseline replay double-request path', async () => {
    const gapState = createReplayState({
      canonicalProtocolAnomalyCount: 2,
      projection: null,
    })
    const baselineState = createReplayState({
      canonicalProtocolAnomalyCount: 5,
      projection: null,
    })
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
        state: baselineState,
      })
    const ctx = createBaseContext({ request })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    expect(ctx.log).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith('Replay canonical protocol anomalies detected (count=5)', 'warn')
  })

  it('logs canonical protocol anomalies only when replay count increases across calls', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 51,
        latestCursor: 51,
        hasGap: false,
        state: createReplayState({ canonicalProtocolAnomalyCount: 2 }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 52,
        latestCursor: 52,
        hasGap: false,
        state: createReplayState({ canonicalProtocolAnomalyCount: 2 }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 53,
        latestCursor: 53,
        hasGap: false,
        state: createReplayState({ canonicalProtocolAnomalyCount: 3 }),
      })
    const ctx = createBaseContext({ request })

    await replayThreadEvents('thread-1', undefined, ctx)
    await replayThreadEvents('thread-1', undefined, ctx)
    await replayThreadEvents('thread-1', undefined, ctx)

    expect(ctx.log).toHaveBeenCalledTimes(2)
    expect(ctx.log).toHaveBeenNthCalledWith(1, 'Replay canonical protocol anomalies detected (count=2)', 'warn')
    expect(ctx.log).toHaveBeenNthCalledWith(2, 'Replay canonical protocol anomalies detected (count=3)', 'warn')
  })

  it('continues incremental replay after hasGap rebuild without duplicate anomaly warnings', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: createReplayState({
          canonicalProtocolAnomalyCount: 2,
          projection: null,
        }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 120,
        latestCursor: 120,
        hasGap: false,
        state: createReplayState({
          canonicalProtocolAnomalyCount: 2,
          projection: null,
        }),
      })
      .mockResolvedValueOnce({
        data: [{ replaySeq: 121, method: 'turn/started', params: { replaySeq: 121 } }],
        nextCursor: 121,
        latestCursor: 121,
        hasGap: false,
        state: createReplayState({
          canonicalProtocolAnomalyCount: 2,
        }),
      })
    const ctx = createBaseContext({ request })

    await replayThreadEvents('thread-1', undefined, ctx)
    await replayThreadEvents('thread-1', undefined, ctx)

    expect(request).toHaveBeenNthCalledWith(1, 'thread/replay', {
      threadId: 'thread-1',
      after: 50,
      limit: 200,
    })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: 'thread-1' })
    expect(request).toHaveBeenNthCalledWith(3, 'thread/replay', {
      threadId: 'thread-1',
      after: 120,
      limit: 200,
    })
    expect(ctx.handleNotification).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith('Replay canonical protocol anomalies detected (count=2)', 'warn')
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(121)
  })
})
