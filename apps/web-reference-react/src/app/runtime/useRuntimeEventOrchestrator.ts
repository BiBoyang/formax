import { useCallback, useMemo } from 'react'
import type { RpcNotification } from '../../types'
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
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    syncPendingInputsFromReplayState,
    loadThreadHistory,
    archivedHandlerDeps,
  } = args

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
      dispatch,
      handleNotification,
      loadThreadHistory,
      log,
      logsByThreadIdRef,
      replayAnomalyCountSeenByThreadRef,
      replayCursorByThreadRef,
      request,
      runtimeStateByThreadRef,
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
