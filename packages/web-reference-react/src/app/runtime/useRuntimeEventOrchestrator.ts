import { useCallback, useMemo, useRef } from 'react'
import type {
  CompactBoundarySummary,
  DurableSnipSummary,
  RequestCollapseSummary,
  RpcNotification,
  SessionMemoryRestoreSummary,
  TranscriptItem,
} from '../../types'
import {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  isReplMode,
  reduceThreadRuntimeState,
} from '../../semantics'
import { mapThreadHistoryToCanonicalLogs } from '../../eventAdapters'
import { parseThreadMessagesResponse, parseThreadReplayResponse } from '../core/rpcContracts'
import { toRuntimePendingInputsById } from '../core/threadTransforms'
import {
  processNotification,
  type ProcessNotificationContext,
} from './processNotification'
import {
  replayThreadEvents as runReplayThreadEvents,
  type ReplayThreadEventsContext,
} from './replayThreadEvents'
import {
  createThreadArchivedHandler,
  type ThreadArchivedHandlerDeps,
} from './notifications/handleThreadArchived'
import { withDevPerformanceSync } from '../core/devPerformance'
import {
  areCompactBoundarySummariesEqual,
  isSameCompactBoundaryGenerationForCache,
  mergeCompactBoundarySummaryForCache,
} from '../core/compactBoundarySummary'
import { areRequestCollapseSummariesEqual } from '../core/requestCollapseSummary'
import { withRecordValue } from '../core/threadCache'

function compactBoundaryEventShape(boundary: CompactBoundarySummary): CompactBoundarySummary {
  const { boundaryFingerprint: _boundaryFingerprint, preservedSegment: _preservedSegment, ...rest } = boundary
  return rest
}

function areCompactBoundaryEventShapesEqual(left: CompactBoundarySummary, right: CompactBoundarySummary): boolean {
  return areCompactBoundarySummariesEqual(compactBoundaryEventShape(left), compactBoundaryEventShape(right))
}

export type UseRuntimeEventOrchestratorArgs = {
  devPerfEnabled: boolean
  request: ReplayThreadEventsContext['request']
  dispatch: ProcessNotificationContext['dispatch']
  log: ProcessNotificationContext['log']
  cacheThreadMode: ProcessNotificationContext['cacheThreadMode']
  refreshThreads: ProcessNotificationContext['refreshThreads']
  refreshWorkspaceDiff: ProcessNotificationContext['refreshWorkspaceDiff']
  setMode: ProcessNotificationContext['setMode']
  setAskDockOpenByInputId: ProcessNotificationContext['setAskDockOpenByInputId']
  setAskPageIndexByInputId: ProcessNotificationContext['setAskPageIndexByInputId']
  setAskDraftByInputId: ProcessNotificationContext['setAskDraftByInputId']
  setSubmitStatusByInputId: ProcessNotificationContext['setSubmitStatusByInputId']
  shouldProcessSequencedNotification: ProcessNotificationContext['shouldProcessSequencedNotification']
  resetSequencedNotificationOwner?: (owner: Parameters<ProcessNotificationContext['shouldProcessSequencedNotification']>[1]) => void
  runtimeStateByThreadRef: ProcessNotificationContext['runtimeStateByThreadRef']
  replayCursorByThreadRef: ProcessNotificationContext['replayCursorByThreadRef']
  replayAnomalyCountSeenByThreadRef: ReplayThreadEventsContext['replayAnomalyCountSeenByThreadRef']
  activeThreadIdRef: ProcessNotificationContext['activeThreadIdRef']
  commandByTurnRef: ProcessNotificationContext['commandByTurnRef']
  logsByThreadIdRef: ReplayThreadEventsContext['logsByThreadIdRef']
  stateLogsRef: ReplayThreadEventsContext['stateLogsRef']
  transcriptSourceByThreadRef: ReplayThreadEventsContext['transcriptSourceByThreadRef']
  historyCursorByThreadIdRef?: { current: Record<string, string | null> }
  latestCompactBoundaryByThreadIdRef: { current: Record<string, CompactBoundarySummary | null> }
  durableSnipByThreadIdRef: { current: Record<string, DurableSnipSummary | null> }
  latestRequestCollapseByThreadIdRef: { current: Record<string, RequestCollapseSummary | null> }
  pendingSessionMemoryRestoreByThreadIdRef?: { current: Record<string, SessionMemoryRestoreSummary | null> }
  setLatestCompactBoundaryByThreadId: (
    updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>,
  ) => void
  setLatestRequestCollapseByThreadId: (
    updater: (prev: Record<string, RequestCollapseSummary | null>) => Record<string, RequestCollapseSummary | null>,
  ) => void
  setDurableSnipByThreadId: (
    updater: (prev: Record<string, DurableSnipSummary | null>) => Record<string, DurableSnipSummary | null>,
  ) => void
  setPendingSessionMemoryRestoreByThreadId?: (
    updater: (
      prev: Record<string, SessionMemoryRestoreSummary | null>,
    ) => Record<string, SessionMemoryRestoreSummary | null>,
  ) => void
  setLogsByThreadId?: (
    updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>,
  ) => void
  setHistoryCursorByThreadId?: (
    updater: (prev: Record<string, string | null>) => Record<string, string | null>,
  ) => void
  setThreadTranscriptSource: ReplayThreadEventsContext['setThreadTranscriptSource']
  clearThreadHistoryCursor: ReplayThreadEventsContext['clearThreadHistoryCursor']
  syncPendingInputsFromReplayState: ReplayThreadEventsContext['syncPendingInputsFromReplayState']
  loadThreadHistory: ReplayThreadEventsContext['loadThreadHistory']
  archivedHandlerDeps: Pick<
    ThreadArchivedHandlerDeps,
    | 'pruneThreadScopedRuntimeRefs'
    | 'setNoticeMessage'
    | 'setSelectedCwd'
    | 'selectThreadRef'
    | 'threadsRef'
    | 'pendingArchiveOpsRef'
  >
}

export function useRuntimeEventOrchestrator(args: UseRuntimeEventOrchestratorArgs) {
  const {
    devPerfEnabled,
    request,
    dispatch,
    log,
    cacheThreadMode,
    refreshThreads,
    refreshWorkspaceDiff,
    setMode,
    setAskDockOpenByInputId,
    setAskPageIndexByInputId,
    setAskDraftByInputId,
    setSubmitStatusByInputId,
    shouldProcessSequencedNotification,
    resetSequencedNotificationOwner = () => {},
    runtimeStateByThreadRef,
    replayCursorByThreadRef,
    replayAnomalyCountSeenByThreadRef,
    activeThreadIdRef,
    commandByTurnRef,
    logsByThreadIdRef,
    stateLogsRef,
    transcriptSourceByThreadRef,
    historyCursorByThreadIdRef = { current: {} },
    latestCompactBoundaryByThreadIdRef,
    durableSnipByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    pendingSessionMemoryRestoreByThreadIdRef = { current: {} },
    setLatestCompactBoundaryByThreadId,
    setDurableSnipByThreadId,
    setLatestRequestCollapseByThreadId,
    setPendingSessionMemoryRestoreByThreadId = () => {},
    setLogsByThreadId = () => {},
    setHistoryCursorByThreadId = () => {},
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    syncPendingInputsFromReplayState,
    loadThreadHistory,
    archivedHandlerDeps,
  } = args

  const areLatestCompactBoundaryEqual = useCallback(
    (
      left: CompactBoundarySummary | null | undefined,
      right: CompactBoundarySummary | null | undefined,
    ): boolean => areCompactBoundarySummariesEqual(left, right),
    [],
  )
  const liveCompactBoundaryByThreadRef = useRef<
    Record<string, { turnId: string; boundary: CompactBoundarySummary; previousBoundary?: CompactBoundarySummary | null }>
  >({})
  const liveNotificationSeqByThreadRef = useRef<Record<string, number>>({})

  const cacheLatestCompactBoundary = useCallback(
    (
      threadId: string,
      boundary: CompactBoundarySummary | null | undefined,
      options?: { replayCompactBoundaryTurnIds?: readonly string[] },
    ): void => {
      if (boundary === undefined) return
      const current = latestCompactBoundaryByThreadIdRef.current[threadId] ?? null
      const nextBoundary = mergeCompactBoundarySummaryForCache(current, boundary)
      if (areLatestCompactBoundaryEqual(current, nextBoundary)) return
      let pending = liveCompactBoundaryByThreadRef.current[threadId]
      if (
        pending &&
        options?.replayCompactBoundaryTurnIds?.includes(pending.turnId) &&
        nextBoundary &&
        areCompactBoundaryEventShapesEqual(nextBoundary, pending.boundary)
      ) {
        pending = {
          ...pending,
          boundary: nextBoundary,
        }
        liveCompactBoundaryByThreadRef.current = {
          ...liveCompactBoundaryByThreadRef.current,
          [threadId]: pending,
        }
      }
      if (
        pending &&
        pending.previousBoundary === undefined &&
        nextBoundary &&
        !isSameCompactBoundaryGenerationForCache(pending.boundary, nextBoundary) &&
        !areLatestCompactBoundaryEqual(nextBoundary, pending.boundary)
      ) {
        liveCompactBoundaryByThreadRef.current = {
          ...liveCompactBoundaryByThreadRef.current,
          [threadId]: {
            ...pending,
            previousBoundary: nextBoundary,
          },
        }
      }
      latestCompactBoundaryByThreadIdRef.current = withRecordValue(latestCompactBoundaryByThreadIdRef.current, threadId, nextBoundary)
      setLatestCompactBoundaryByThreadId((prev) => withRecordValue(prev, threadId, nextBoundary))
    },
    [areLatestCompactBoundaryEqual, latestCompactBoundaryByThreadIdRef, setLatestCompactBoundaryByThreadId],
  )

  const cacheLatestRequestCollapse = useCallback(
    (threadId: string, collapse: RequestCollapseSummary | null | undefined): void => {
      if (collapse === undefined) return
      const current = latestRequestCollapseByThreadIdRef.current[threadId] ?? null
      if (areRequestCollapseSummariesEqual(current, collapse)) return
      latestRequestCollapseByThreadIdRef.current = withRecordValue(
        latestRequestCollapseByThreadIdRef.current,
        threadId,
        collapse,
      )
      setLatestRequestCollapseByThreadId((prev) => withRecordValue(prev, threadId, collapse))
    },
    [latestRequestCollapseByThreadIdRef, setLatestRequestCollapseByThreadId],
  )

  const cacheDurableSnip = useCallback(
    (threadId: string, durableSnip: DurableSnipSummary | null | undefined): void => {
      if (durableSnip === undefined) return
      const current = durableSnipByThreadIdRef.current[threadId] ?? null
      if (
        current === durableSnip ||
        (current &&
          durableSnip &&
          current.stage === durableSnip.stage &&
          current.status === durableSnip.status &&
          current.applied === durableSnip.applied &&
          current.reason === durableSnip.reason &&
          current.removedMessageCount === durableSnip.removedMessageCount &&
          current.droppedOrphanToolBlockCount === durableSnip.droppedOrphanToolBlockCount &&
          current.removalRangeCount === durableSnip.removalRangeCount)
      ) {
        return
      }
      durableSnipByThreadIdRef.current = withRecordValue(durableSnipByThreadIdRef.current, threadId, durableSnip)
      setDurableSnipByThreadId((prev) => withRecordValue(prev, threadId, durableSnip))
    },
    [durableSnipByThreadIdRef, setDurableSnipByThreadId],
  )

  const cachePendingSessionMemoryRestore = useCallback(
    (threadId: string, restore: SessionMemoryRestoreSummary | null | undefined): void => {
      if (restore === undefined) return
      if (pendingSessionMemoryRestoreByThreadIdRef.current[threadId] === restore) return
      pendingSessionMemoryRestoreByThreadIdRef.current = withRecordValue(
        pendingSessionMemoryRestoreByThreadIdRef.current,
        threadId,
        restore,
      )
      setPendingSessionMemoryRestoreByThreadId((prev) => withRecordValue(prev, threadId, restore))
    },
    [pendingSessionMemoryRestoreByThreadIdRef, setPendingSessionMemoryRestoreByThreadId],
  )

  const cacheLiveCompactBoundary = useCallback(
    (input: { threadId: string; turnId: string; boundary: CompactBoundarySummary }): void => {
      const existing = liveCompactBoundaryByThreadRef.current[input.threadId]
      const hasCurrentBoundary = Object.prototype.hasOwnProperty.call(
        latestCompactBoundaryByThreadIdRef.current,
        input.threadId,
      )
      const currentBoundary = hasCurrentBoundary ? (latestCompactBoundaryByThreadIdRef.current[input.threadId] ?? null) : undefined
      const previousBoundary =
        existing && existing.turnId === input.turnId
          ? existing.previousBoundary
          : currentBoundary
      liveCompactBoundaryByThreadRef.current = {
        ...liveCompactBoundaryByThreadRef.current,
        [input.threadId]: {
          turnId: input.turnId,
          boundary: input.boundary,
          previousBoundary,
        },
      }
      cacheLatestCompactBoundary(input.threadId, input.boundary)
    },
    [cacheLatestCompactBoundary, latestCompactBoundaryByThreadIdRef],
  )

  const commitLiveCompactBoundary = useCallback((input: { threadId: string; turnId: string }): void => {
    const existing = liveCompactBoundaryByThreadRef.current[input.threadId]
    if (!existing || existing.turnId !== input.turnId) return
    const next = { ...liveCompactBoundaryByThreadRef.current }
    delete next[input.threadId]
    liveCompactBoundaryByThreadRef.current = next
    cacheLatestCompactBoundary(input.threadId, existing.boundary)
  }, [cacheLatestCompactBoundary])

  const clearLiveCompactBoundary = useCallback(
    (input: { threadId: string; turnId: string }): void => {
      const existing = liveCompactBoundaryByThreadRef.current[input.threadId]
      if (!existing || existing.turnId !== input.turnId) return
      const next = { ...liveCompactBoundaryByThreadRef.current }
      delete next[input.threadId]
      liveCompactBoundaryByThreadRef.current = next
      const currentBoundary = latestCompactBoundaryByThreadIdRef.current[input.threadId] ?? null
      const rollbackBoundary =
        existing.previousBoundary !== undefined
          ? existing.previousBoundary
          : areLatestCompactBoundaryEqual(currentBoundary, existing.boundary)
            ? null
            : currentBoundary
      cacheLatestCompactBoundary(input.threadId, rollbackBoundary)
    },
    [areLatestCompactBoundaryEqual, cacheLatestCompactBoundary, latestCompactBoundaryByThreadIdRef],
  )

  const handleThreadArchivedNotification = useMemo(
    () =>
      createThreadArchivedHandler({
        dispatch,
        pruneThreadScopedRuntimeRefs: archivedHandlerDeps.pruneThreadScopedRuntimeRefs,
        refreshWorkspaceDiff,
        setNoticeMessage: archivedHandlerDeps.setNoticeMessage,
        setSelectedCwd: archivedHandlerDeps.setSelectedCwd,
        selectThreadRef: archivedHandlerDeps.selectThreadRef,
        setMode,
        threadsRef: archivedHandlerDeps.threadsRef,
        activeThreadIdRef,
        pendingArchiveOpsRef: archivedHandlerDeps.pendingArchiveOpsRef,
      }),
    [
      activeThreadIdRef,
      archivedHandlerDeps.pendingArchiveOpsRef,
      archivedHandlerDeps.pruneThreadScopedRuntimeRefs,
      archivedHandlerDeps.selectThreadRef,
      archivedHandlerDeps.setNoticeMessage,
      archivedHandlerDeps.setSelectedCwd,
      archivedHandlerDeps.threadsRef,
      dispatch,
      refreshWorkspaceDiff,
      setMode,
    ],
  )

  const processRuntimeNotification = useCallback(
    (
      notification: RpcNotification,
      acceptSequencedNotification: ProcessNotificationContext['shouldProcessSequencedNotification'],
      owner: Parameters<ProcessNotificationContext['shouldProcessSequencedNotification']>[1],
      overrides: Partial<Pick<
        ProcessNotificationContext,
        | 'runtimeStateByThreadRef'
        | 'replayCursorByThreadRef'
        | 'dispatch'
        | 'setMode'
        | 'cacheThreadMode'
        | 'setAskDockOpenByInputId'
        | 'setAskPageIndexByInputId'
        | 'setAskDraftByInputId'
        | 'setSubmitStatusByInputId'
        | 'refreshThreads'
        | 'refreshWorkspaceDiff'
        | 'cacheLiveCompactBoundary'
        | 'commitLiveCompactBoundary'
        | 'clearLiveCompactBoundary'
        | 'onThreadArchivedNotification'
      >> = {},
    ) => {
      withDevPerformanceSync({
        enabled: devPerfEnabled,
        label: `web-ref:notification:${notification.method}`,
        run: () =>
          processNotification(notification, {
            runtimeStateByThreadRef: overrides.runtimeStateByThreadRef ?? runtimeStateByThreadRef,
            replayCursorByThreadRef: overrides.replayCursorByThreadRef ?? replayCursorByThreadRef,
            activeThreadIdRef,
            commandByTurnRef,
            createInitialThreadRuntimeState,
            shouldProcessSequencedNotification: acceptSequencedNotification,
            dispatch: overrides.dispatch ?? dispatch,
            setMode: overrides.setMode ?? setMode,
            cacheThreadMode: overrides.cacheThreadMode ?? cacheThreadMode,
            isReplMode,
            refreshThreads: overrides.refreshThreads ?? refreshThreads,
            refreshWorkspaceDiff: overrides.refreshWorkspaceDiff ?? refreshWorkspaceDiff,
            log,
            setAskDockOpenByInputId: overrides.setAskDockOpenByInputId ?? setAskDockOpenByInputId,
            setAskPageIndexByInputId: overrides.setAskPageIndexByInputId ?? setAskPageIndexByInputId,
            setAskDraftByInputId: overrides.setAskDraftByInputId ?? setAskDraftByInputId,
            setSubmitStatusByInputId: overrides.setSubmitStatusByInputId ?? setSubmitStatusByInputId,
            reduceThreadRuntimeState,
            cacheLiveCompactBoundary: overrides.cacheLiveCompactBoundary ?? cacheLiveCompactBoundary,
            commitLiveCompactBoundary: overrides.commitLiveCompactBoundary ?? commitLiveCompactBoundary,
            clearLiveCompactBoundary: overrides.clearLiveCompactBoundary ?? clearLiveCompactBoundary,
            onThreadArchivedNotification: overrides.onThreadArchivedNotification ?? handleThreadArchivedNotification,
          }, owner),
      })
    },
    [
      activeThreadIdRef,
      cacheThreadMode,
      cacheLiveCompactBoundary,
      clearLiveCompactBoundary,
      commitLiveCompactBoundary,
      commandByTurnRef,
      devPerfEnabled,
      dispatch,
      handleThreadArchivedNotification,
      log,
      refreshThreads,
      refreshWorkspaceDiff,
      replayCursorByThreadRef,
      runtimeStateByThreadRef,
      setAskDockOpenByInputId,
      setAskDraftByInputId,
      setAskPageIndexByInputId,
      setMode,
      setSubmitStatusByInputId,
    ],
  )

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      const threadId = extractThreadIdFromNotificationParams(notification.params)
      if (threadId) {
        liveNotificationSeqByThreadRef.current[threadId] =
          (liveNotificationSeqByThreadRef.current[threadId] ?? 0) + 1
      }
      processRuntimeNotification(notification, shouldProcessSequencedNotification, { kind: 'live-stream' })
    },
    [processRuntimeNotification, shouldProcessSequencedNotification],
  )

  const handleReplayNotification = useCallback(
    (
      threadId: string,
      notification: RpcNotification,
      acceptSequencedNotification: ProcessNotificationContext['shouldProcessSequencedNotification'],
      overrides?: Parameters<typeof processRuntimeNotification>[3],
    ) => {
      processRuntimeNotification(
        notification,
        acceptSequencedNotification,
        { kind: 'thread-replay', threadId },
        overrides,
      )
    },
    [processRuntimeNotification],
  )

  const replayThreadEvents = useCallback(
    async (threadId: string, options?: { fromStart?: boolean }): Promise<boolean> => {
      const isFullReplay = options?.fromStart === true
      const originalThreadLiveNotificationSeq = liveNotificationSeqByThreadRef.current[threadId] ?? 0
      const originalActiveThreadId = activeThreadIdRef.current
      const originalRuntimeState = runtimeStateByThreadRef.current[threadId]
      const originalReplayCursor = replayCursorByThreadRef.current[threadId]
      const replayRuntimeStateByThreadRef =
        isFullReplay ? { current: { ...runtimeStateByThreadRef.current } } : runtimeStateByThreadRef
      const replayCursorByThreadRefForRun =
        isFullReplay ? { current: { ...replayCursorByThreadRef.current } } : replayCursorByThreadRef
      const stagedSideEffects: Array<() => void | Promise<void>> = []
      const stage = (effect: () => void | Promise<void>): void => {
        if (isFullReplay) {
          stagedSideEffects.push(effect)
        } else {
          void effect()
        }
      }
      const hasLiveFullReplayStateChanged = (): boolean =>
        isFullReplay && (
          activeThreadIdRef.current !== originalActiveThreadId ||
          (liveNotificationSeqByThreadRef.current[threadId] ?? 0) !== originalThreadLiveNotificationSeq ||
          runtimeStateByThreadRef.current[threadId] !== originalRuntimeState ||
          replayCursorByThreadRef.current[threadId] !== originalReplayCursor
        )
      if (isFullReplay) {
        resetSequencedNotificationOwner({ kind: 'thread-replay', threadId })
        delete replayRuntimeStateByThreadRef.current[threadId]
        delete replayCursorByThreadRefForRun.current[threadId]
      }
      const stagedNotificationOverrides: Parameters<typeof processRuntimeNotification>[3] = {
        runtimeStateByThreadRef: replayRuntimeStateByThreadRef,
        replayCursorByThreadRef: replayCursorByThreadRefForRun,
        dispatch: (action) => stage(() => dispatch(action)),
        setMode: (mode) => stage(() => setMode(mode)),
        cacheThreadMode: (nextThreadId, mode) => stage(() => cacheThreadMode(nextThreadId, mode)),
        setAskDockOpenByInputId: (updater) => stage(() => setAskDockOpenByInputId(updater)),
        setAskPageIndexByInputId: (updater) => stage(() => setAskPageIndexByInputId(updater)),
        setAskDraftByInputId: (updater) => stage(() => setAskDraftByInputId(updater)),
        setSubmitStatusByInputId: (updater) => stage(() => setSubmitStatusByInputId(updater)),
        refreshThreads: async () => {
          stage(() => refreshThreads().catch(() => undefined))
        },
        refreshWorkspaceDiff: async () => {
          stage(() => refreshWorkspaceDiff().catch(() => undefined))
        },
        cacheLiveCompactBoundary: (args) => stage(() => cacheLiveCompactBoundary(args)),
        commitLiveCompactBoundary: (args) => stage(() => commitLiveCompactBoundary(args)),
        clearLiveCompactBoundary: (args) => stage(() => clearLiveCompactBoundary(args)),
        onThreadArchivedNotification: (params) => stage(() => handleThreadArchivedNotification(params)),
      }
      return runReplayThreadEvents(threadId, options, {
        request,
        parseThreadReplayResponse,
        toRuntimePendingInputsById,
        replayCursorByThreadRef: replayCursorByThreadRefForRun,
        replayAnomalyCountSeenByThreadRef,
        runtimeStateByThreadRef: replayRuntimeStateByThreadRef,
        runtimeStateBaselineByThreadRef: isFullReplay ? runtimeStateByThreadRef : undefined,
        activeThreadIdRef,
        logsByThreadIdRef,
        stateLogsRef,
        transcriptSourceByThreadRef,
        cacheLatestCompactBoundary: (...args) => stage(() => cacheLatestCompactBoundary(...args)),
        cacheDurableSnip: (...args) => stage(() => cacheDurableSnip(...args)),
        cacheLatestRequestCollapse: (...args) => stage(() => cacheLatestRequestCollapse(...args)),
        cachePendingSessionMemoryRestore: (...args) => stage(() => cachePendingSessionMemoryRestore(...args)),
        dispatch: (action) => stage(() => dispatch(action)),
        setMode: (mode) => stage(() => setMode(mode)),
        cacheThreadMode: (nextThreadId, mode) => stage(() => cacheThreadMode(nextThreadId, mode)),
        setThreadTranscriptSource: (nextThreadId, source) => stage(() => setThreadTranscriptSource(nextThreadId, source)),
        clearThreadHistoryCursor: (nextThreadId) => stage(() => clearThreadHistoryCursor(nextThreadId)),
        syncPendingInputsFromReplayState: (nextThreadId, replayState) =>
          stage(() => syncPendingInputsFromReplayState(nextThreadId, replayState)),
        loadThreadHistory: async (nextThreadId) => {
          if (!isFullReplay) return loadThreadHistory(nextThreadId)
          try {
            const historyResult = await request('thread/messages', { threadId: nextThreadId, limit: 50 })
            if (activeThreadIdRef.current !== nextThreadId) return false
            const parsed = parseThreadMessagesResponse(historyResult)
            const logs = mapThreadHistoryToCanonicalLogs({ threadId: nextThreadId, messages: parsed.data })
            stage(() => dispatch({ type: 'set_active_turn', turnId: null }))
            stage(() => dispatch({ type: 'clear_pending_inputs' }))
            stage(() => dispatch({ type: 'replace_logs', logs }))
            stage(() => setLogsByThreadId((prev) => withRecordValue(prev, nextThreadId, logs)))
            stage(() => cacheLatestCompactBoundary(nextThreadId, parsed.latestCompactBoundary))
            stage(() => cacheDurableSnip(nextThreadId, parsed.durableSnip))
            stage(() => cacheLatestRequestCollapse(nextThreadId, parsed.latestRequestCollapse))
            stage(() => {
              const nextCursor = parsed.nextCursor
              if ((historyCursorByThreadIdRef.current[nextThreadId] ?? null) === nextCursor) return
              historyCursorByThreadIdRef.current = withRecordValue(
                historyCursorByThreadIdRef.current,
                nextThreadId,
                nextCursor,
              )
              setHistoryCursorByThreadId((prev) => withRecordValue(prev, nextThreadId, nextCursor))
            })
            stage(() => setThreadTranscriptSource(nextThreadId, 'history'))
            return true
          } catch {
            if (activeThreadIdRef.current !== nextThreadId) return false
            return false
          }
        },
        handleNotification: (notification) =>
          handleReplayNotification(
            threadId,
            notification,
            shouldProcessSequencedNotification,
            stagedNotificationOverrides,
          ),
        log,
      }).then(async (loaded) => {
        if (!isFullReplay) return loaded
        if (!loaded || hasLiveFullReplayStateChanged()) {
          resetSequencedNotificationOwner({ kind: 'thread-replay', threadId })
          return loaded
        }
        const replayRuntimeState = replayRuntimeStateByThreadRef.current[threadId]
        if (replayRuntimeState) {
          runtimeStateByThreadRef.current[threadId] = replayRuntimeState
        } else {
          delete runtimeStateByThreadRef.current[threadId]
        }
        const replayCursor = replayCursorByThreadRefForRun.current[threadId]
        if (typeof replayCursor === 'number') {
          replayCursorByThreadRef.current[threadId] = replayCursor
        } else {
          delete replayCursorByThreadRef.current[threadId]
        }
        for (const effect of stagedSideEffects) await effect()
        return loaded
      }).catch((error) => {
        if (isFullReplay) {
          resetSequencedNotificationOwner({ kind: 'thread-replay', threadId })
        }
        throw error
      })
    },
    [
      activeThreadIdRef,
      cacheThreadMode,
      clearThreadHistoryCursor,
      cacheLatestCompactBoundary,
      cacheDurableSnip,
      cacheLatestRequestCollapse,
      cachePendingSessionMemoryRestore,
      dispatch,
      handleReplayNotification,
      handleNotification,
      historyCursorByThreadIdRef,
      loadThreadHistory,
      latestCompactBoundaryByThreadIdRef,
      log,
      logsByThreadIdRef,
      pendingSessionMemoryRestoreByThreadIdRef,
      replayAnomalyCountSeenByThreadRef,
      replayCursorByThreadRef,
      request,
      runtimeStateByThreadRef,
      setLatestCompactBoundaryByThreadId,
      setHistoryCursorByThreadId,
      setLogsByThreadId,
      setPendingSessionMemoryRestoreByThreadId,
      setMode,
      setThreadTranscriptSource,
      stateLogsRef,
      syncPendingInputsFromReplayState,
      transcriptSourceByThreadRef,
    ],
  )

  return {
    handleNotification,
    replayThreadEvents,
  }
}
