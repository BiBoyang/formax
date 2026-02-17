import { describe, expect, it, vi } from 'vitest'
import {
  replayThreadEvents,
  resolveReplayCursorProgress,
  type ReplayThreadEventsContext,
} from './replayThreadEvents'
import type { ReplayStateSnapshot } from '../core/rpcParsers'

type ReplayPage = ReturnType<ReplayThreadEventsContext['asThreadReplay']>

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

function createReplayPage(overrides: Partial<ReplayPage> = {}): ReplayPage {
  return {
    data: [],
    nextCursor: 0,
    latestCursor: 0,
    hasGap: false,
    state: null,
    ...overrides,
  } as ReplayPage
}

function createReplayRequestSequence(...pages: ReplayPage[]) {
  const request = vi.fn()
  for (const page of pages) {
    request.mockResolvedValueOnce(page)
  }
  return request
}

describe('resolveReplayCursorProgress', () => {
  it('continues when next cursor advances but remains below latest cursor', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 11, latestCursor: 20 })).toEqual({
      nextAfter: 11,
      shouldContinue: true,
    })
  })

  it('stops when next cursor stalls or rewinds', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 10, latestCursor: 20 })).toEqual({
      nextAfter: 10,
      shouldContinue: false,
    })
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 9, latestCursor: 20 })).toEqual({
      nextAfter: 9,
      shouldContinue: false,
    })
  })

  it('stops when next cursor reaches latest cursor or falls back to latest cursor', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 20, latestCursor: 20 })).toEqual({
      nextAfter: 20,
      shouldContinue: false,
    })
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 0, latestCursor: 20 })).toEqual({
      nextAfter: 20,
      shouldContinue: false,
    })
  })
})

describe('replayThreadEvents', () => {
  it('[rebuild] uses replay-first rebuild on hasGap and clears cached logs', async () => {
    const gapState = createReplayState()
    const request = createReplayRequestSequence(
      createReplayPage({
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: gapState,
      }),
      createReplayPage({
        nextCursor: 120,
        latestCursor: 120,
        state: gapState,
      }),
    )
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

  describe('history paths', () => {
    it('[history] loads history and keeps cursor at zero for fromStart empty replay', async () => {
      const replayState = createReplayState()
      const request = createReplayRequestSequence(
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          state: replayState,
        }),
      )
      const ctx = createBaseContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents('thread-1', { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledWith('thread/replay', {
        threadId: 'thread-1',
        after: 0,
        limit: 200,
      })
      expect(ctx.loadThreadHistory).toHaveBeenCalledWith('thread-1')
      expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(0)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith('thread-1', replayState)
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    })

    it('[history] returns false when fromStart empty replay cannot load history', async () => {
      const request = createReplayRequestSequence(
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          state: null,
        }),
      )
      const ctx = createBaseContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(false),
      })

      const ok = await replayThreadEvents('thread-1', { fromStart: true }, ctx)

      expect(ok).toBe(false)
      expect(ctx.loadThreadHistory).toHaveBeenCalledWith('thread-1')
      expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(50)
      expect(ctx.syncPendingInputsFromReplayState).not.toHaveBeenCalled()
    })
  })

  describe('pagination paths', () => {
    it('[pagination] stops at page limit when replay stream keeps advancing without terminal cursor', async () => {
      const request = vi.fn().mockImplementation((_method: string, params?: unknown) => {
        const after = Number((params as { after?: number } | undefined)?.after ?? 0)
        return Promise.resolve({
          data: [],
          nextCursor: after + 1,
          latestCursor: 1000,
          hasGap: false,
          state: createReplayState(),
        })
      })
      const ctx = createBaseContext({ request })

      const ok = await replayThreadEvents('thread-1', undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(100)
      expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(150)
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    })

    it('[pagination] exits loop when next cursor does not advance beyond current after', async () => {
      const replayState = createReplayState()
      const request = createReplayRequestSequence(
        createReplayPage({
          nextCursor: 50,
          latestCursor: 200,
          state: replayState,
        }),
      )
      const ctx = createBaseContext({ request })

      const ok = await replayThreadEvents('thread-1', undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(50)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith('thread-1', replayState)
    })

    it('[pagination] exits loop when next cursor reaches latest cursor', async () => {
      const replayState = createReplayState()
      const request = createReplayRequestSequence(
        createReplayPage({
          nextCursor: 120,
          latestCursor: 120,
          state: replayState,
        }),
      )
      const ctx = createBaseContext({ request })

      const ok = await replayThreadEvents('thread-1', undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(120)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith('thread-1', replayState)
    })

    it('[pagination] logs invariant and anomaly warnings once on page-limit termination', async () => {
      const request = vi.fn().mockImplementation((_method: string, params?: unknown) => {
        const after = Number((params as { after?: number } | undefined)?.after ?? 0)
        return Promise.resolve({
          data: [],
          nextCursor: after + 1,
          latestCursor: 1000,
          hasGap: false,
          state: createReplayState({
            canonicalProtocolAnomalyCount: 2,
            invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' }],
          }),
        })
      })
      const ctx = createBaseContext({ request })

      const ok = await replayThreadEvents('thread-1', undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(100)
      expect(ctx.log).toHaveBeenCalledTimes(2)
      expect(ctx.log).toHaveBeenNthCalledWith(1, 'Replay invariant issues detected (running_tool_after_terminal_turn=1)', 'warn')
      expect(ctx.log).toHaveBeenNthCalledWith(2, 'Replay canonical protocol anomalies detected (count=2)', 'warn')
    })

    it('[pagination] does not log anomaly warning on boundary exit when anomaly count was already seen', async () => {
      const replayState = createReplayState({
        canonicalProtocolAnomalyCount: 3,
      })
      const request = vi.fn().mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 200,
        hasGap: false,
        state: replayState,
      })
      const ctx = createBaseContext({
        request,
        replayAnomalyCountSeenByThreadRef: { current: { 'thread-1': 3 } },
      })

      const ok = await replayThreadEvents('thread-1', undefined, ctx)

      expect(ok).toBe(true)
      expect(ctx.log).not.toHaveBeenCalled()
    })
  })

  describe('logging basics', () => {
    it('[logging] logs replay invariant issues once per replay request', async () => {
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

    it('[logging] logs canonical protocol anomaly count once per replay request', async () => {
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
  })

  describe('rebuild and promotion paths', () => {
    it('[rebuild] logs invariant issues once on hasGap projection hydration path', async () => {
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

  it('[rebuild] defers hasGap projection hydration for non-active threads', async () => {
    const gapState = createReplayState({
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
    const ctx = createBaseContext({
      request,
      activeThreadIdRef: { current: 'thread-2' },
    })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(ctx.dispatch).not.toHaveBeenCalledWith({
      type: 'hydrate_projection_snapshot',
      threadId: 'thread-1',
      snapshot: gapState.projection,
    })
    expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    expect(ctx.clearThreadHistoryCursor).not.toHaveBeenCalled()
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(50)
    expect(ctx.runtimeStateByThreadRef.current['thread-1']?.lastReplaySeq).toBe(120)
  })

  it('[rebuild] hydrates deferred projection after thread becomes active', async () => {
    const projection = {
      segments: [
        {
          id: 's1',
          kind: 'assistant' as const,
          turnId: 'turn-1',
          text: 'rebuilt',
        },
      ],
      lastReplaySeq: 120,
      toolNameByUseId: {},
      openAssistantSegmentIdByTurn: {},
      openThinkingSegmentIdByTurn: {},
    }
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: createReplayState({ projection }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: createReplayState({ projection }),
      })
    const activeThreadIdRef: ReplayThreadEventsContext['activeThreadIdRef'] = { current: 'thread-2' }
    const ctx = createBaseContext({
      request,
      activeThreadIdRef,
    })

    const firstOk = await replayThreadEvents('thread-1', undefined, ctx)
    expect(firstOk).toBe(true)
    expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(50)

    activeThreadIdRef.current = 'thread-1'
    const secondOk = await replayThreadEvents('thread-1', undefined, ctx)

    expect(secondOk).toBe(true)
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'hydrate_projection_snapshot',
      threadId: 'thread-1',
      snapshot: projection,
    })
    expect(ctx.setThreadTranscriptSource).toHaveBeenCalledWith('thread-1', 'replay')
    expect(ctx.clearThreadHistoryCursor).toHaveBeenCalledWith('thread-1')
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(120)
  })

  it('[rebuild] logs invariant issues once across hasGap baseline replay double-request path', async () => {
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

  it('[rebuild] defers baseline projection hydration for non-active threads after hasGap', async () => {
    const baselineProjection = {
      segments: [
        {
          id: 's1',
          kind: 'assistant' as const,
          turnId: 'turn-1',
          text: 'baseline-rebuilt',
        },
      ],
      lastReplaySeq: 120,
      toolNameByUseId: {},
      openAssistantSegmentIdByTurn: {},
      openThinkingSegmentIdByTurn: {},
    }
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: createReplayState({ projection: null }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 120,
        latestCursor: 120,
        hasGap: false,
        state: createReplayState({ projection: baselineProjection }),
      })
    const ctx = createBaseContext({
      request,
      activeThreadIdRef: { current: 'thread-2' },
    })

    const ok = await replayThreadEvents('thread-1', undefined, ctx)

    expect(ok).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    expect(ctx.dispatch).not.toHaveBeenCalledWith({
      type: 'hydrate_projection_snapshot',
      threadId: 'thread-1',
      snapshot: baselineProjection,
    })
    expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    expect(ctx.clearThreadHistoryCursor).not.toHaveBeenCalled()
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(50)
    expect(ctx.runtimeStateByThreadRef.current['thread-1']?.lastReplaySeq).toBe(120)
  })

  it('[rebuild] logs canonical protocol anomalies once across hasGap baseline replay double-request path', async () => {
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

  it('[logging] logs canonical protocol anomalies only when replay count increases across calls', async () => {
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

  it('[rebuild] continues incremental replay after hasGap rebuild without duplicate anomaly warnings', async () => {
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

    it('[promotion] promotes transcript source from history after rebuild followed by incremental entries', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 50,
        latestCursor: 120,
        hasGap: true,
        state: createReplayState({ projection: null }),
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: 120,
        latestCursor: 120,
        hasGap: false,
        state: createReplayState({ projection: null }),
      })
      .mockResolvedValueOnce({
        data: [{ replaySeq: 121, method: 'turn/started', params: { replaySeq: 121 } }],
        nextCursor: 121,
        latestCursor: 121,
        hasGap: false,
        state: createReplayState(),
      })
    const transcriptSourceByThreadRef: ReplayThreadEventsContext['transcriptSourceByThreadRef'] = {
      current: { 'thread-1': 'history' },
    }
    const setThreadTranscriptSource = vi.fn((threadId: string, source: 'replay' | 'history') => {
      transcriptSourceByThreadRef.current[threadId] = source
    })
    const ctx = createBaseContext({
      request,
      transcriptSourceByThreadRef,
      setThreadTranscriptSource,
    })

    await replayThreadEvents('thread-1', undefined, ctx)
    expect(ctx.setThreadTranscriptSource).toHaveBeenCalledTimes(1)

    await replayThreadEvents('thread-1', undefined, ctx)

      expect(ctx.setThreadTranscriptSource).toHaveBeenCalledTimes(2)
      expect(ctx.setThreadTranscriptSource).toHaveBeenNthCalledWith(2, 'thread-1', 'replay')
    })
  })
})
