import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompactBoundarySummary } from '../../types'
import { useRuntimeEventOrchestrator } from './useRuntimeEventOrchestrator'

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
