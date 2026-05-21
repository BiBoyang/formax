import { useCallback, useMemo, useRef } from 'react'
import type { CompactBoundarySummary, DurableSnipSummary, RequestCollapseSummary, RpcNotification } from '../../types'
import {
  createInitialThreadRuntimeState,
  isReplMode,
  reduceThreadRuntimeState,
} from '../../semantics'
import { parseThreadReplayResponse } from '../core/rpcContracts'
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
import { areCompactBoundarySummariesEqual } from '../core/compactBoundarySummary'
import { areRequestCollapseSummariesEqual } from '../core/requestCollapseSummary'
import { withRecordValue } from '../core/threadCache'

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
  runtimeStateByThreadRef: ProcessNotificationContext['runtimeStateByThreadRef']
  replayCursorByThreadRef: ProcessNotificationContext['replayCursorByThreadRef']
  replayAnomalyCountSeenByThreadRef: ReplayThreadEventsContext['replayAnomalyCountSeenByThreadRef']
  activeThreadIdRef: ProcessNotificationContext['activeThreadIdRef']
  commandByTurnRef: ProcessNotificationContext['commandByTurnRef']
  logsByThreadIdRef: ReplayThreadEventsContext['logsByThreadIdRef']
  stateLogsRef: ReplayThreadEventsContext['stateLogsRef']
  transcriptSourceByThreadRef: ReplayThreadEventsContext['transcriptSourceByThreadRef']
  latestCompactBoundaryByThreadIdRef: { current: Record<string, CompactBoundarySummary | null> }
  durableSnipByThreadIdRef: { current: Record<string, DurableSnipSummary | null> }
  latestRequestCollapseByThreadIdRef: { current: Record<string, RequestCollapseSummary | null> }
  setLatestCompactBoundaryByThreadId: (
    updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>,
  ) => void
  setLatestRequestCollapseByThreadId: (
    updater: (prev: Record<string, RequestCollapseSummary | null>) => Record<string, RequestCollapseSummary | null>,
  ) => void
  setDurableSnipByThreadId: (
    updater: (prev: Record<string, DurableSnipSummary | null>) => Record<string, DurableSnipSummary | null>,
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
    runtimeStateByThreadRef,
    replayCursorByThreadRef,
    replayAnomalyCountSeenByThreadRef,
    activeThreadIdRef,
    commandByTurnRef,
    logsByThreadIdRef,
    stateLogsRef,
    transcriptSourceByThreadRef,
    latestCompactBoundaryByThreadIdRef,
    durableSnipByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    setLatestCompactBoundaryByThreadId,
    setDurableSnipByThreadId,
    setLatestRequestCollapseByThreadId,
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

  const cacheLatestCompactBoundary = useCallback(
    (threadId: string, boundary: CompactBoundarySummary | null | undefined): void => {
      if (boundary === undefined) return
      const current = latestCompactBoundaryByThreadIdRef.current[threadId] ?? null
      if (areLatestCompactBoundaryEqual(current, boundary)) return
      const pending = liveCompactBoundaryByThreadRef.current[threadId]
      if (
        pending &&
        pending.previousBoundary === undefined &&
        !areLatestCompactBoundaryEqual(boundary, pending.boundary)
      ) {
        liveCompactBoundaryByThreadRef.current = {
          ...liveCompactBoundaryByThreadRef.current,
          [threadId]: {
            ...pending,
            previousBoundary: boundary,
          },
        }
      }
      latestCompactBoundaryByThreadIdRef.current = withRecordValue(latestCompactBoundaryByThreadIdRef.current, threadId, boundary)
      setLatestCompactBoundaryByThreadId((prev) => withRecordValue(prev, threadId, boundary))
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

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      withDevPerformanceSync({
        enabled: devPerfEnabled,
        label: `web-ref:notification:${notification.method}`,
        run: () =>
          processNotification(notification, {
            runtimeStateByThreadRef,
            replayCursorByThreadRef,
            activeThreadIdRef,
            commandByTurnRef,
            createInitialThreadRuntimeState,
            shouldProcessSequencedNotification,
            dispatch,
            setMode,
            cacheThreadMode,
            isReplMode,
            refreshThreads,
            refreshWorkspaceDiff,
            log,
            setAskDockOpenByInputId,
            setAskPageIndexByInputId,
            setAskDraftByInputId,
            setSubmitStatusByInputId,
            reduceThreadRuntimeState,
            cacheLiveCompactBoundary,
            commitLiveCompactBoundary,
            clearLiveCompactBoundary,
            onThreadArchivedNotification: handleThreadArchivedNotification,
          }),
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
      shouldProcessSequencedNotification,
    ],
  )

  const replayThreadEvents = useCallback(
    async (threadId: string, options?: { fromStart?: boolean }): Promise<boolean> => {
      return runReplayThreadEvents(threadId, options, {
        request,
        parseThreadReplayResponse,
        toRuntimePendingInputsById,
        replayCursorByThreadRef,
        replayAnomalyCountSeenByThreadRef,
        runtimeStateByThreadRef,
        activeThreadIdRef,
        logsByThreadIdRef,
        stateLogsRef,
        transcriptSourceByThreadRef,
        cacheLatestCompactBoundary,
        cacheDurableSnip,
        cacheLatestRequestCollapse,
        dispatch,
        setMode,
        cacheThreadMode,
        setThreadTranscriptSource,
        clearThreadHistoryCursor,
        syncPendingInputsFromReplayState,
        loadThreadHistory,
        handleNotification,
        log,
      })
    },
    [
      activeThreadIdRef,
      cacheThreadMode,
      clearThreadHistoryCursor,
      cacheLatestCompactBoundary,
      cacheDurableSnip,
      cacheLatestRequestCollapse,
      dispatch,
      handleNotification,
      loadThreadHistory,
      latestCompactBoundaryByThreadIdRef,
      log,
      logsByThreadIdRef,
      replayAnomalyCountSeenByThreadRef,
      replayCursorByThreadRef,
      request,
      runtimeStateByThreadRef,
      setLatestCompactBoundaryByThreadId,
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
