import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompactBoundarySummary } from '../../types'
import { useRuntimeEventOrchestrator } from './useRuntimeEventOrchestrator'
import { createReplayTurnEventEnvelope } from './testFixtures/replayFixtures'
import {
  createTurnEventCursorState,
  shouldAcceptSequencedNotification,
} from '../../turnEventCursor'
import type { ThreadRuntimeState } from '../../semantics'

function createBoundary(overrides: Partial<CompactBoundarySummary> = {}): CompactBoundarySummary {
  return {
    schemaVersion: 1,
    trigger: 'auto',
    preTokens: 2048,
    summaryKind: 'session_memory',
    ...overrides,
  }
}

describe('useRuntimeEventOrchestrator', () => {
  it('hydrates replay entries through the thread replay sequencer instead of the live sequencer', async () => {
    const eventCursor = createTurnEventCursorState()
    expect(
      shouldAcceptSequencedNotification(eventCursor, { replaySeq: 100, eventId: 'live-100' }, { kind: 'live-stream' }),
    ).toBe(true)
    const shouldProcessSequencedNotification = vi.fn((params, owner) =>
      shouldAcceptSequencedNotification(eventCursor, params, owner),
    )
    const dispatch = vi.fn()
    const replayCursorByThreadRef: { current: Record<string, number> } = { current: {} }
    const runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> } = { current: {} }
    const replayEntry = createReplayTurnEventEnvelope({
      replaySeq: 5,
      eventId: 'replay-5',
      event: { type: 'assistant_delta', text: 'from replay' },
    })
    const staleReplayEntry = createReplayTurnEventEnvelope({
      replaySeq: 4,
      eventId: 'replay-4',
      event: { type: 'assistant_delta', text: 'stale replay' },
    })
    const request = vi.fn(async () => ({
      data: [
        { replaySeq: 5, method: 'turn/event', params: replayEntry },
        { replaySeq: 4, method: 'turn/event', params: staleReplayEntry },
      ],
      nextCursor: 5,
      latestCursor: 5,
      hasGap: false,
      state: null,
    }))

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request,
        dispatch,
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification,
        runtimeStateByThreadRef,
        replayCursorByThreadRef,
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef: { current: {} },
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId: vi.fn(),
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    await act(async () => {
      await result.current.replayThreadEvents('thread-1')
    })

    expect(shouldProcessSequencedNotification).toHaveBeenCalledWith(replayEntry, {
      kind: 'thread-replay',
      threadId: 'thread-1',
    })
    expect(shouldProcessSequencedNotification).toHaveBeenCalledWith(staleReplayEntry, {
      kind: 'thread-replay',
      threadId: 'thread-1',
    })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply_canonical_event',
        event: expect.objectContaining({
          kind: 'assistant_delta',
          replaySeq: 5,
          textDelta: 'from replay',
        }),
      }),
    )
    expect(
      dispatch.mock.calls.filter(([action]) => action?.type === 'apply_canonical_event'),
    ).toHaveLength(1)
    expect(runtimeStateByThreadRef.current['thread-1']?.lastReplaySeq).toBe(5)
    expect(replayCursorByThreadRef.current['thread-1']).toBe(5)

  })

  it('commits full replay when unrelated live traffic arrives during the replay request', async () => {
    const eventCursor = createTurnEventCursorState()
    const shouldProcessSequencedNotification = vi.fn((params, owner) =>
      shouldAcceptSequencedNotification(eventCursor, params, owner),
    )
    const dispatch = vi.fn()
    const replayCursorByThreadRef: { current: Record<string, number> } = { current: {} }
    const runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> } = { current: {} }
    const replayEntry = createReplayTurnEventEnvelope({
      replaySeq: 1,
      eventId: 'replay-thread-1',
      event: { type: 'assistant_delta', text: 'thread one replay' },
    })
    let handleLiveNotification: ((notification: Parameters<ReturnType<typeof useRuntimeEventOrchestrator>['handleNotification']>[0]) => void) | null = null
    const request = vi.fn(async () => {
      handleLiveNotification?.({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 100,
          eventId: 'live-thread-2',
          ts: '2026-02-18T00:00:00.000Z',
          source: 'engine',
          threadId: 'thread-2',
          turnId: 'turn-thread-2',
          event: { type: 'assistant_delta', text: 'background event' },
        },
      })
      return {
        data: [{ replaySeq: 1, method: 'turn/event', params: replayEntry }],
        nextCursor: 1,
        latestCursor: 1,
        hasGap: false,
        state: null,
      }
    })

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request,
        dispatch,
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification,
        runtimeStateByThreadRef,
        replayCursorByThreadRef,
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef: { current: {} },
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId: vi.fn(),
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )
    handleLiveNotification = result.current.handleNotification

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply_canonical_event',
        event: expect.objectContaining({
          kind: 'assistant_delta',
          replaySeq: 1,
          textDelta: 'thread one replay',
        }),
      }),
    )
    expect(replayCursorByThreadRef.current['thread-1']).toBe(1)
  })

  it('does not commit full-replay history fallback when same-thread live traffic conflicts', async () => {
    const dispatch = vi.fn()
    const eventCursor = createTurnEventCursorState()
    const shouldProcessSequencedNotification = vi.fn((params, owner) =>
      shouldAcceptSequencedNotification(eventCursor, params, owner),
    )
    let handleLiveNotification: ((notification: Parameters<ReturnType<typeof useRuntimeEventOrchestrator>['handleNotification']>[0]) => void) | null = null
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/messages') {
        handleLiveNotification?.({
          jsonrpc: '2.0',
          method: 'turn/event',
          params: {
            replaySeq: 10,
            eventId: 'live-thread-1',
            ts: '2026-02-18T00:00:01.000Z',
            source: 'engine',
            threadId: 'thread-1',
            turnId: 'turn-thread-1-live',
            event: { type: 'assistant_delta', text: 'live conflict' },
          },
        })
        return { data: [], nextCursor: 'cursor-next' }
      }
      return {
        data: [],
        nextCursor: 0,
        latestCursor: 0,
        hasGap: false,
        state: null,
      }
    })

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request,
        dispatch,
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: {} },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef: { current: {} },
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId: vi.fn(),
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => {
          throw new Error('full replay should use the staged history fallback')
        }),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )
    handleLiveNotification = result.current.handleNotification

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })

    expect(dispatch.mock.calls.some(([action]) => action?.type === 'replace_logs')).toBe(false)
  })

  it('rolls back pending live compact boundary cache when the same turn fails', () => {
    const previousBoundary = createBoundary({ trigger: 'manual', preTokens: 1024, summaryKind: 'model_summary' })
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {
      'thread-1': previousBoundary,
    }
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({})),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: {} },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 10,
          eventId: 'evt-10',
          ts: '2026-02-18T00:00:00.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-compact',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(liveBoundary)

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 11,
          eventId: 'evt-11',
          ts: '2026-02-18T00:00:01.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-compact', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(previousBoundary)
  })

  it('rolls back to the pre-replay boundary when replay cached the same live boundary first', async () => {
    const previousBoundary = createBoundary({ trigger: 'manual', preTokens: 1024, summaryKind: 'model_summary' })
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {
      'thread-1': previousBoundary,
    }
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )
    const request = vi.fn(async () => ({
      data: [
        {
          replaySeq: 10,
          method: 'turn/event',
          params: {
            replaySeq: 10,
            eventId: 'evt-10',
            ts: '2026-02-18T00:00:00.000Z',
            source: 'engine',
            threadId: 'thread-1',
            turnId: 'turn-compact',
            event: {
              type: 'compact_boundary',
              boundary: liveBoundary,
            },
          },
        },
      ],
      nextCursor: 10,
      latestCursor: 10,
      hasGap: false,
      state: null,
      latestCompactBoundary: liveBoundary,
      pendingSessionMemoryRestore: null,
    }))

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request,
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: { 'thread-1': 0 } },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(liveBoundary)

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 11,
          eventId: 'evt-11',
          ts: '2026-02-18T00:00:01.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-compact', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(previousBoundary)
  })

  it('keeps the committed boundary when an equal live compact turn fails later', () => {
    const committedBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {
      'thread-1': committedBoundary,
    }
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({})),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: {} },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 20,
          eventId: 'evt-20',
          ts: '2026-02-18T00:00:02.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-equal-compact',
          event: {
            type: 'compact_boundary',
            boundary: committedBoundary,
          },
        },
      })
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 21,
          eventId: 'evt-21',
          ts: '2026-02-18T00:00:03.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-equal-compact', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(committedBoundary)
  })

  it('uses metadata hydrated during a pending live compact as the rollback boundary', async () => {
    const previousBoundary = createBoundary({ trigger: 'manual', preTokens: 1024, summaryKind: 'model_summary' })
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({
          data: [],
          nextCursor: 0,
          latestCursor: 0,
          hasGap: false,
          state: null,
          latestCompactBoundary: previousBoundary,
          pendingSessionMemoryRestore: null,
        })),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: { 'thread-1': 0 } },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 30,
          eventId: 'evt-30',
          ts: '2026-02-18T00:00:04.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-live-before-hydrate',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
    })

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 31,
          eventId: 'evt-31',
          ts: '2026-02-18T00:00:05.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-live-before-hydrate', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(previousBoundary)
  })

  it('preserves metadata hydrated outside replay while a live compact is pending', () => {
    const previousBoundary = createBoundary({ trigger: 'manual', preTokens: 1024, summaryKind: 'model_summary' })
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({})),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: {} },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 40,
          eventId: 'evt-40',
          ts: '2026-02-18T00:00:06.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-live-before-messages',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
    })
    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(liveBoundary)

    latestCompactBoundaryByThread = { 'thread-1': previousBoundary }
    latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 41,
          eventId: 'evt-41',
          ts: '2026-02-18T00:00:07.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-live-before-messages', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(previousBoundary)
  })

  it('does not use same-turn live compact event metadata enrichment as the rollback boundary', async () => {
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    const enrichedLiveBoundary = {
      ...liveBoundary,
      boundaryFingerprint: 'compact-boundary-live-1',
    }
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({
          data: [
            {
              replaySeq: 51,
              method: 'turn/event',
              params: {
                replaySeq: 51,
                eventId: 'evt-51',
                ts: '2026-02-18T00:00:09.000Z',
                source: 'engine',
                threadId: 'thread-1',
                turnId: 'turn-live-enriched',
                event: {
                  type: 'compact_boundary',
                  boundary: enrichedLiveBoundary,
                },
              },
            },
          ],
          nextCursor: 51,
          latestCursor: 51,
          hasGap: false,
          state: null,
          latestCompactBoundary: enrichedLiveBoundary,
          pendingSessionMemoryRestore: null,
        })),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: { 'thread-1': 0 } },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 50,
          eventId: 'evt-50',
          ts: '2026-02-18T00:00:08.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-live-enriched',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
    })
    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(liveBoundary)

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })
    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(enrichedLiveBoundary)

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 51,
          eventId: 'evt-51',
          ts: '2026-02-18T00:00:09.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-live-enriched', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toBeNull()
  })

  it('preserves a committed compact snapshot with matching shallow fields when a pending compact fails', async () => {
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    const committedBoundary = {
      ...liveBoundary,
      boundaryFingerprint: 'committed-boundary-1',
    }
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({
          data: [],
          nextCursor: 0,
          latestCursor: 0,
          hasGap: false,
          state: null,
          latestCompactBoundary: committedBoundary,
          pendingSessionMemoryRestore: null,
        })),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: { 'thread-1': 0 } },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 60,
          eventId: 'evt-60',
          ts: '2026-02-18T00:00:10.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-live-with-committed-snapshot',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
    })

    await act(async () => {
      await result.current.replayThreadEvents('thread-1', { fromStart: true })
    })
    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(committedBoundary)

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 61,
          eventId: 'evt-61',
          ts: '2026-02-18T00:00:11.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-live-with-committed-snapshot', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(committedBoundary)
  })

  it('clears the live compact boundary when the first compact turn fails without prior metadata', () => {
    const liveBoundary = createBoundary({
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    })
    let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
    const latestCompactBoundaryByThreadIdRef = {
      current: latestCompactBoundaryByThread,
    }
    const setLatestCompactBoundaryByThreadId = vi.fn(
      (updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>) => {
        latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
        latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      },
    )

    const { result } = renderHook(() =>
      useRuntimeEventOrchestrator({
        devPerfEnabled: false,
        request: vi.fn(async () => ({})),
        dispatch: vi.fn(),
        log: vi.fn(),
        cacheThreadMode: vi.fn(),
        refreshThreads: vi.fn(async () => {}),
        refreshWorkspaceDiff: vi.fn(async () => {}),
        setMode: vi.fn(),
        setAskDockOpenByInputId: vi.fn(),
        setAskPageIndexByInputId: vi.fn(),
        setAskDraftByInputId: vi.fn(),
        setSubmitStatusByInputId: vi.fn(),
        shouldProcessSequencedNotification: () => true,
        runtimeStateByThreadRef: { current: {} },
        replayCursorByThreadRef: { current: {} },
        replayAnomalyCountSeenByThreadRef: { current: {} },
        activeThreadIdRef: { current: 'thread-1' },
        commandByTurnRef: { current: new Map() },
        logsByThreadIdRef: { current: {} },
        stateLogsRef: { current: [] },
        transcriptSourceByThreadRef: { current: {} },
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef: { current: {} },
        latestRequestCollapseByThreadIdRef: { current: {} },
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId: vi.fn(),
        setLatestRequestCollapseByThreadId: vi.fn(),
        setThreadTranscriptSource: vi.fn(),
        clearThreadHistoryCursor: vi.fn(),
        syncPendingInputsFromReplayState: vi.fn(),
        loadThreadHistory: vi.fn(async () => true),
        archivedHandlerDeps: {
          pruneThreadScopedRuntimeRefs: vi.fn(),
          setNoticeMessage: vi.fn(),
          setSelectedCwd: vi.fn(),
          selectThreadRef: { current: vi.fn() },
          threadsRef: { current: [] },
          pendingArchiveOpsRef: { current: new Map() },
        },
      }),
    )

    act(() => {
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: {
          replaySeq: 40,
          eventId: 'evt-40',
          ts: '2026-02-18T00:00:06.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-first-compact',
          event: {
            type: 'compact_boundary',
            boundary: liveBoundary,
          },
        },
      })
      result.current.handleNotification({
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 41,
          eventId: 'evt-41',
          ts: '2026-02-18T00:00:07.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-first-compact', threadId: 'thread-1', status: 'failed' },
          error: 'compact failed before persistence',
        },
      })
    })

    expect(latestCompactBoundaryByThreadIdRef.current['thread-1']).toBeNull()
  })
})
