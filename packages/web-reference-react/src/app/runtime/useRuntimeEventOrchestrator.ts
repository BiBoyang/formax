import { useCallback, useMemo } from 'react'
import type { CompactBoundarySummary, RpcNotification } from '../../types'
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
  setLatestCompactBoundaryByThreadId: (
    updater: (prev: Record<string, CompactBoundarySummary | null>) => Record<string, CompactBoundarySummary | null>,
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
    setLatestCompactBoundaryByThreadId,
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
    ): boolean => {
      if (!left && !right) return true
      if (!left || !right) return false
      const leftKeepMinTokens = left.keepStrategy?.kind === 'keep_combo' ? left.keepStrategy.keepMinTokens : null
      const rightKeepMinTokens = right.keepStrategy?.kind === 'keep_combo' ? right.keepStrategy.keepMinTokens : null
      const leftKeepMinUserTurns = left.keepStrategy?.kind === 'keep_combo' ? left.keepStrategy.keepMinUserTurns : null
      const rightKeepMinUserTurns = right.keepStrategy?.kind === 'keep_combo' ? right.keepStrategy.keepMinUserTurns : null
      return (
        left.schemaVersion === right.schemaVersion &&
        (left.trigger ?? null) === (right.trigger ?? null) &&
        (left.triggerReason?.kind ?? null) === (right.triggerReason?.kind ?? null) &&
        (left.triggerReason?.detail ?? null) === (right.triggerReason?.detail ?? null) &&
        (left.preTokens ?? null) === (right.preTokens ?? null) &&
        (left.summaryKind ?? null) === (right.summaryKind ?? null) &&
        (left.keepStrategy?.kind ?? null) === (right.keepStrategy?.kind ?? null) &&
        (left.keepStrategy?.keepLastTurns ?? null) === (right.keepStrategy?.keepLastTurns ?? null) &&
        leftKeepMinTokens === rightKeepMinTokens &&
        leftKeepMinUserTurns === rightKeepMinUserTurns &&
        (left.rehydrationCost?.sectionCount ?? null) === (right.rehydrationCost?.sectionCount ?? null) &&
        (left.rehydrationCost?.estimatedTokens ?? null) === (right.rehydrationCost?.estimatedTokens ?? null) &&
        JSON.stringify(left.rehydrationPlan?.items ?? null) === JSON.stringify(right.rehydrationPlan?.items ?? null) &&
        (left.preservedSegment?.continuationMessageCount ?? null) ===
          (right.preservedSegment?.continuationMessageCount ?? null) &&
        (left.preservedSegment?.preservedTailMessageCount ?? null) ===
          (right.preservedSegment?.preservedTailMessageCount ?? null) &&
        (left.preservedSegment?.summaryFingerprint ?? null) ===
          (right.preservedSegment?.summaryFingerprint ?? null) &&
        (left.preservedSegment?.headFingerprint ?? null) === (right.preservedSegment?.headFingerprint ?? null) &&
        (left.preservedSegment?.tailFingerprint ?? null) === (right.preservedSegment?.tailFingerprint ?? null)
      )
    },
    [],
  )

  const cacheLatestCompactBoundary = useCallback(
    (threadId: string, boundary: CompactBoundarySummary | null | undefined): void => {
      if (boundary === undefined) return
      const current = latestCompactBoundaryByThreadIdRef.current[threadId] ?? null
      if (areLatestCompactBoundaryEqual(current, boundary)) return
      latestCompactBoundaryByThreadIdRef.current = withRecordValue(latestCompactBoundaryByThreadIdRef.current, threadId, boundary)
      setLatestCompactBoundaryByThreadId((prev) => withRecordValue(prev, threadId, boundary))
    },
    [areLatestCompactBoundaryEqual, latestCompactBoundaryByThreadIdRef, setLatestCompactBoundaryByThreadId],
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
            onThreadArchivedNotification: handleThreadArchivedNotification,
          }),
      })
    },
    [
      activeThreadIdRef,
      cacheThreadMode,
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
