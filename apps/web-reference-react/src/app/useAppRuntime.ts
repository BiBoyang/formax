import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react'
import { appReducer, initialAppState } from '../store'
import type { RpcNotification, TranscriptItem } from '../types'
import type { RpcClientQueueMetrics } from '../rpcClient'
import { shouldAcceptSequencedNotification } from '../turnEventCursor'
import { type DiffSnapshot } from '../components/WorktreeDiffPane'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import { resolveRpcQueueRuntimeConfig } from './core/rpcQueueConfig'
import { parseThreadGroupHideResponse, parseThreadReplayResponse } from './core/rpcContracts'
import {
  type ThreadTranscriptSource,
} from './core/replayMachine'
import {
  INITIAL_THREAD_CACHE_STATE,
  withThreadCacheSlice,
  type ThreadCacheState,
} from './core/threadCache'
import {
  toRpcError,
  toRuntimePendingInputsById,
} from './core/threadTransforms'
import { isTranscriptVirtualizationEnabled } from './core/transcriptVirtualization'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { processNotification } from './runtime/processNotification'
import { replayThreadEvents as runReplayThreadEvents } from './runtime/replayThreadEvents'
import { createThreadArchivedHandler } from './runtime/notifications/handleThreadArchived'
import { createComposerActions } from './runtime/composerActions'
import { createThreadActions } from './runtime/threadActions'
import type { SelectThreadOptions } from './runtime/threadActions'
import { usePendingInputUiState } from './runtime/usePendingInputUiState'
import { createThreadDataOps } from './runtime/threadDataOps'
import { useRpcConnectionEffect } from './runtime/useRpcConnectionEffect'
import { useThreadSelection } from './runtime/useThreadSelection'
import { useRuntimeRefSync } from './runtime/useRuntimeRefSync'
import { useRpcRequest } from './runtime/useRpcRequest'
import {
  useRpcRefs,
  useThreadSnapshotRefs,
  useHistoryRefs,
  useThreadCacheRefs,
  useThreadRuntimeRefs,
} from './runtime/useRuntimeRefs'
import { useThreadModeCache } from './runtime/useThreadModeCache'
import { useInitializeHandshake } from './runtime/useInitializeHandshake'
import { pruneThreadScopedRefs } from './runtime/threadScopedRefs'
import { useDevRuntimeApi } from './runtime/useDevRuntimeApi'
import { useTranscriptDisplayState } from './runtime/useTranscriptDisplayState'
import { useThreadUrlSync } from './runtime/useThreadUrlSync'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ArchiveThreadLike,
} from '../semantics'
import { isReplMode, type ReplMode } from '../semantics'
import {
  isDevPerformanceEnabled,
  withDevPerformanceSync,
} from './core/devPerformance'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const fromRuntimeConfig = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim()) {
    return fromRuntimeConfig
  }
  return DEFAULT_BRIDGE_URL
}

function isDevRuntime(): boolean {
  return import.meta.env.DEV
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useAppRuntime(ports?: RuntimePorts): AppShellProps {
  const runtimePorts = useMemo(() => ports ?? createDefaultRuntimePorts(), [ports])
  const devRuntime = useMemo(() => isDevRuntime(), [])
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [rpcQueueConfig] = useState(resolveRpcQueueRuntimeConfig)
  const [inputText, setInputText] = useState('')
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [devLoadAllRequested, setDevLoadAllRequested] = useState(false)
  const [devLoadAllBootstrapAttempts, setDevLoadAllBootstrapAttempts] = useState(0)
  const [devLoadAllSawHistoryLoading, setDevLoadAllSawHistoryLoading] = useState(false)
  const { isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth, rightRailWidth, setRightRailWidth } =
    usePaneLayout()
  const [mode, setMode] = useState<ReplMode>('normal')
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null)
  const [hiddenGroupCwds, setHiddenGroupCwds] = useState<string[]>([])
  const setInputTextStable = useCallback((next: SetStateAction<string>) => {
    setInputText((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next
      return resolved === previous ? previous : resolved
    })
  }, [])
  const setIsThreadActionBusyStable = useCallback((next: boolean) => {
    setIsThreadActionBusy((previous) => (previous === next ? previous : next))
  }, [])
  const setIsSendingTurnStable = useCallback((next: boolean) => {
    setIsSendingTurn((previous) => (previous === next ? previous : next))
  }, [])
  const setIsInterruptingTurnStable = useCallback((next: boolean) => {
    setIsInterruptingTurn((previous) => (previous === next ? previous : next))
  }, [])
  const setIsSubmittingInputStable = useCallback((next: boolean) => {
    setIsSubmittingInput((previous) => (previous === next ? previous : next))
  }, [])
  const setIsRefreshingDiffStable = useCallback((next: boolean) => {
    setIsRefreshingDiff((previous) => (previous === next ? previous : next))
  }, [])
  const setDevLoadAllRequestedStable = useCallback((next: boolean) => {
    setDevLoadAllRequested((previous) => (previous === next ? previous : next))
  }, [])
  const setDevLoadAllBootstrapAttemptsStable = useCallback((next: number) => {
    setDevLoadAllBootstrapAttempts((previous) => (previous === next ? previous : next))
  }, [])
  const setDevLoadAllSawHistoryLoadingStable = useCallback((next: boolean) => {
    setDevLoadAllSawHistoryLoading((previous) => (previous === next ? previous : next))
  }, [])
  const setModeStable = useCallback((next: SetStateAction<ReplMode>) => {
    setMode((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next
      return resolved === previous ? previous : resolved
    })
  }, [])
  const setSelectedCwdStable = useCallback((next: string | null) => {
    setSelectedCwd((previous) => (previous === next ? previous : next))
  }, [])
  const setNoticeMessageStable = useCallback((next: string | null) => {
    setNoticeMessage((previous) => (previous === next ? previous : next))
  }, [])
  const setHiddenGroupCwdsStable = useCallback((next: string[]) => {
    setHiddenGroupCwds((previous) => (areStringArraysEqual(previous, next) ? previous : next))
  }, [])
  const [threadCache, setThreadCache] = useState<ThreadCacheState>(INITIAL_THREAD_CACHE_STATE)
  const logsByThreadId = threadCache.logsByThreadId
  const historyCursorByThreadId = threadCache.historyCursorByThreadId
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})
  const transcriptSourceByThreadId = threadCache.transcriptSourceByThreadId
  const setLogsByThreadId = useCallback(
    (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => {
      setThreadCache((prev) => withThreadCacheSlice(prev, 'logsByThreadId', updater(prev.logsByThreadId)))
    },
    [],
  )
  const setHistoryCursorByThreadId = useCallback(
    (updater: (prev: Record<string, string | null>) => Record<string, string | null>) => {
      setThreadCache((prev) =>
        withThreadCacheSlice(prev, 'historyCursorByThreadId', updater(prev.historyCursorByThreadId)),
      )
    },
    [],
  )
  const setTranscriptSourceByThreadId = useCallback(
    (
      updater: (
        prev: Record<string, ThreadTranscriptSource>,
      ) => Record<string, ThreadTranscriptSource>,
    ) => {
      setThreadCache((prev) =>
        withThreadCacheSlice(prev, 'transcriptSourceByThreadId', updater(prev.transcriptSourceByThreadId)),
      )
    },
    [],
  )

  // Refs 分组（130+ 行 → 6 行）
  const rpcRefs = useRpcRefs()
  const threadSnapshotRefs = useThreadSnapshotRefs(
    state.activeThreadId,
    state.threads,
    selectedCwd,
    state.selectedInputId,
    state.logs
  )
  const historyRefs = useHistoryRefs(historyCursorByThreadId)
  const threadCacheRefs = useThreadCacheRefs(logsByThreadId, transcriptSourceByThreadId)
  const threadRuntimeRefs = useThreadRuntimeRefs()

  // 展开使用（如果需要）
  const { clientRef, eventCursorRef, commandByTurnRef } = rpcRefs
  const { activeThreadIdRef, threadsRef, selectedCwdRef, selectedInputIdRef, stateLogsRef } = threadSnapshotRefs
  const { historyLoadTokenRef, historyLoadSeqByThreadRef, historyLoadingRef, historyCursorByThreadIdRef } = historyRefs
  const { logsByThreadIdRef, transcriptSourceByThreadRef } = threadCacheRefs
  const { replayCursorByThreadRef, replayAnomalyCountSeenByThreadRef, runtimeStateByThreadRef } = threadRuntimeRefs

  // 其他 Refs（不在分组中）
  const pendingArchiveOpsRef = useRef<Map<string, { threadId: string; thread: ArchiveThreadLike | null }>>(new Map())
  const rpcQueueMetricsRef = useRef<RpcClientQueueMetrics | null>(null)
  const selectThreadRef = useRef<(threadId: string, options?: SelectThreadOptions) => void>(() => undefined)
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const activeTurnIdRef = useRef<string | null>(state.activeTurnId)
  const pendingInputsRef = useRef(state.pendingInputs)
  const transcriptVirtualizationEnabled = useMemo(
    () => isTranscriptVirtualizationEnabled({ isDevRuntime: devRuntime }),
    [devRuntime],
  )
  const devPerfEnabled = useMemo(() => isDevPerformanceEnabled({ isDevRuntime: devRuntime }), [devRuntime])
  const {
    activeHistoryLoading,
    activeLogs,
    activeThread,
    activeThreadTitle,
    historyMore,
  } = useTranscriptDisplayState({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    logs: state.logs,
    logsByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    displayPolicy: 'debug',
  })

  const pruneThreadScopedRuntimeRefs = useCallback(
    (threads: Array<{ id: string }>) => {
      const preservedThreadIds = Array.from(
        new Set(
          Array.from(pendingArchiveOpsRef.current.values())
            .map((entry) => entry.threadId)
            .filter((threadId) => threadId.length > 0),
        ),
      )
      pruneThreadScopedRefs({
        threadIds: threads.map((thread) => thread.id),
        preservedThreadIds,
        replayCursorByThreadRef,
        replayAnomalyCountSeenByThreadRef,
        runtimeStateByThreadRef,
      })
    },
    [],
  )

  useEffect(() => {
    pruneThreadScopedRuntimeRefs(state.threads)
  }, [pruneThreadScopedRuntimeRefs, state.threads])

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])
  const onRpcQueueMetrics = useCallback(
    (metrics: RpcClientQueueMetrics) => {
      const previous = rpcQueueMetricsRef.current
      rpcQueueMetricsRef.current = metrics
      if (!previous) return

      const overloadedDelta = metrics.overloadedRequests - previous.overloadedRequests
      if (overloadedDelta > 0) {
        log(
          `[rpc] outbound request queue overloaded (+${overloadedDelta}, depth ${metrics.outboundQueueDepth}/${metrics.outboundQueueCapacity})`,
          'warn',
        )
      }

      const droppedOutboundDelta = metrics.droppedOutboundNotifications - previous.droppedOutboundNotifications
      if (droppedOutboundDelta > 0) {
        log(
          `[rpc] dropped outbound notifications (+${droppedOutboundDelta}, depth ${metrics.outboundQueueDepth}/${metrics.outboundQueueCapacity})`,
          'warn',
        )
      }

      const droppedInboundDelta = metrics.droppedInboundNotifications - previous.droppedInboundNotifications
      if (droppedInboundDelta > 0) {
        log(
          `[rpc] dropped inbound notifications (+${droppedInboundDelta}, depth ${metrics.inboundNotificationQueueDepth}/${metrics.inboundNotificationQueueCapacity})`,
          'warn',
        )
      }
    },
    [log],
  )
  const { lastRpcError, captureError, request } = useRpcRequest({ clientRef, log })
  const { cacheThreadMode } = useThreadModeCache({
    runtimeStateByThreadRef,
    nowIso: runtimePorts.nowIso,
  })
  const { initializeHandshake } = useInitializeHandshake({ clientRef })

  const shouldProcessSequencedNotification = useCallback(
    (params: unknown): boolean => {
      return shouldAcceptSequencedNotification(eventCursorRef.current, params)
    },
    [],
  )

  const {
    selectedInput,
    selectedAskDraft,
    selectedAskPageIndex,
    isSelectedAskOpen,
    composerLocked,
    submitStatus,
    setSubmitStatusByInputId,
    setAskDockOpenByInputId,
    setAskDraftByInputId,
    setAskPageIndexByInputId,
    onAskOpen,
    onAskDismiss,
    onAskPageChange,
    onAskDraftChange,
    syncPendingInputsFromReplayState,
  } = usePendingInputUiState({
    pendingInputs: state.pendingInputs,
    selectedInputId: state.selectedInputId,
    dispatch,
    activeThreadIdRef,
    selectedInputIdRef,
  })

  const {
    refreshThreads,
    refreshWorkspaceDiff,
    requestDiffFilePatch,
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    loadThreadHistory,
    resumeThreadInputs,
    loadEarlierHistory: loadEarlierHistoryAction,
  } = useMemo(
    () =>
      createThreadDataOps({
        request,
        dispatch,
        log,
        activeThreadIdRef,
        historyLoadTokenRef,
        historyLoadSeqByThreadRef,
        historyLoadingRef,
        historyCursorByThreadIdRef,
        transcriptSourceByThreadRef,
        logsByThreadIdRef,
        stateLogsRef,
        seenStaleInputIdRef,
        setIsRefreshingDiff: setIsRefreshingDiffStable,
        setDiffSnapshot,
        setHistoryLoadingByThreadId,
        setHistoryCursorByThreadId,
        setTranscriptSourceByThreadId,
        setLogsByThreadId,
        setHiddenGroupCwds: setHiddenGroupCwdsStable,
        resolveDiffCwd: () => {
          if (selectedCwdRef.current) return selectedCwdRef.current
          const activeThreadId = activeThreadIdRef.current
          if (!activeThreadId) return null
          return threadsRef.current.find((thread) => thread.id === activeThreadId)?.cwd ?? null
        },
      }),
    [log, request, setHiddenGroupCwdsStable, setIsRefreshingDiffStable],
  )

  const hideThreadGroup = useCallback(
    async (cwd: string) => {
      const nextCwd = cwd.trim()
      if (!nextCwd) return
      const result = await request('thread/group/hide', { cwd: nextCwd })
      setHiddenGroupCwdsStable(parseThreadGroupHideResponse(result))
    },
    [request, setHiddenGroupCwdsStable],
  )

  const handleThreadArchivedNotification = useMemo(
    () => createThreadArchivedHandler({
      dispatch,
      pruneThreadScopedRuntimeRefs,
      refreshWorkspaceDiff,
      setNoticeMessage: setNoticeMessageStable,
      setSelectedCwd: setSelectedCwdStable,
      selectThreadRef, // 传 ref 本身，不是 current
      setMode: setModeStable,
      threadsRef,
      activeThreadIdRef,
      pendingArchiveOpsRef,
    }),
    [dispatch, pruneThreadScopedRuntimeRefs, refreshWorkspaceDiff, setNoticeMessageStable, setSelectedCwdStable, setModeStable],
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
            setMode: setModeStable,
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
      cacheThreadMode,
      devPerfEnabled,
      handleThreadArchivedNotification,
      log,
      refreshThreads,
      refreshWorkspaceDiff,
      setModeStable,
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
        setMode: setModeStable,
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
      request,
      cacheThreadMode,
      clearThreadHistoryCursor,
      loadThreadHistory,
      handleNotification,
      log,
      parseThreadReplayResponse,
      setModeStable,
      setThreadTranscriptSource,
      syncPendingInputsFromReplayState,
    ],
  )

  useRuntimeRefSync({
    activeThreadId: state.activeThreadId,
    logs: state.logs,
    logsByThreadId,
    logsByThreadIdRef,
    setLogsByThreadId,
  })

  useEffect(() => {
    activeTurnIdRef.current = state.activeTurnId
  }, [state.activeTurnId])

  useEffect(() => {
    pendingInputsRef.current = state.pendingInputs
  }, [state.pendingInputs])

  const { sortedThreads } = useThreadSelection({
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    selectedCwd,
    setSelectedCwd: setSelectedCwdStable,
  })
  const sortedThreadsRef = useRef(sortedThreads)

  useEffect(() => {
    sortedThreadsRef.current = sortedThreads
  }, [sortedThreads])

  const threadActionsState = useMemo(
    () => ({
      get activeThreadId() {
        return activeThreadIdRef.current
      },
      get activeTurnId() {
        return activeTurnIdRef.current
      },
      get selectedInputId() {
        return selectedInputIdRef.current
      },
      get pendingInputs() {
        return pendingInputsRef.current
      },
      get logs() {
        return stateLogsRef.current
      },
      get threads() {
        return threadsRef.current
      },
    }),
    [],
  )

  const { startThread, startThreadInCwd, selectThread, selectCwd, renameThread, archiveThread, loadEarlierHistory } = useMemo(
    () =>
      createThreadActions({
        get selectedCwd() {
          return selectedCwdRef.current
        },
        setSelectedCwd: setSelectedCwdStable,
        state: threadActionsState,
        get sortedThreads() {
          return sortedThreadsRef.current
        },
        get logsByThreadId() {
          return logsByThreadIdRef.current
        },
        request,
        dispatch,
        log,
        setMode: setModeStable,
        runtimeStateByThreadRef,
        replayCursorByThreadRef,
        activeThreadIdRef,
        setIsThreadActionBusy: setIsThreadActionBusyStable,
        replayThreadEvents,
        resumeThreadInputs,
        refreshThreads,
        refreshWorkspaceDiff,
        trackArchiveOp: ({ opId, threadId, thread }) => {
          pendingArchiveOpsRef.current.set(opId, { threadId, thread: thread ?? null })
          pruneThreadScopedRuntimeRefs(threadsRef.current)
        },
        clearArchiveOp: (opId) => {
          return pendingArchiveOpsRef.current.delete(opId)
        },
        loadEarlierHistoryAction,
      }),
    [
      log,
      refreshThreads,
      refreshWorkspaceDiff,
      replayThreadEvents,
      request,
      resumeThreadInputs,
      pruneThreadScopedRuntimeRefs,
      loadEarlierHistoryAction,
      setIsThreadActionBusyStable,
      setModeStable,
      setSelectedCwdStable,
      threadActionsState,
    ],
  )

  useEffect(() => {
    selectThreadRef.current = selectThread
  }, [selectThread])

  useEffect(() => {
    if (!noticeMessage) return
    const timer = window.setTimeout(() => setNoticeMessageStable(null), 2600)
    return () => window.clearTimeout(timer)
  }, [noticeMessage, setNoticeMessageStable])

  const resetDevLoadAllState = useCallback(() => {
    setDevLoadAllRequestedStable(false)
    setDevLoadAllBootstrapAttemptsStable(0)
    setDevLoadAllSawHistoryLoadingStable(false)
  }, [setDevLoadAllBootstrapAttemptsStable, setDevLoadAllRequestedStable, setDevLoadAllSawHistoryLoadingStable])

  const startDevLoadAllState = useCallback(() => {
    setDevLoadAllRequestedStable(true)
    setDevLoadAllBootstrapAttemptsStable(0)
    setDevLoadAllSawHistoryLoadingStable(false)
  }, [setDevLoadAllBootstrapAttemptsStable, setDevLoadAllRequestedStable, setDevLoadAllSawHistoryLoadingStable])

  useEffect(() => {
    resetDevLoadAllState()
  }, [state.activeThreadId, resetDevLoadAllState])

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () =>
      createComposerActions({
        inputText,
        setInputText: setInputTextStable,
        isSendingTurn,
        isInterruptingTurn,
        isSubmittingInput,
        mode,
        activeThreadId: state.activeThreadId,
        activeTurnId: state.activeTurnId,
        resolveRequestCwd: (threadId) => {
          const activeThread = threadsRef.current.find((thread) => thread.id === threadId)
          return selectedCwdRef.current ?? activeThread?.cwd ?? null
        },
        getPendingInputById: (inputId) => pendingInputsRef.current[inputId],
        request,
        dispatch,
        log,
        commandByTurnRef,
        setIsSendingTurn: setIsSendingTurnStable,
        setIsInterruptingTurn: setIsInterruptingTurnStable,
        setIsSubmittingInput: setIsSubmittingInputStable,
        setSubmitStatusByInputId,
        toRpcError,
        nowMs: runtimePorts.nowMs,
        startThread,
      }),
    [
      inputText,
      isInterruptingTurn,
      isSendingTurn,
      isSubmittingInput,
      log,
      mode,
      request,
      runtimePorts.nowMs,
      setInputTextStable,
      setIsInterruptingTurnStable,
      setIsSendingTurnStable,
      setIsSubmittingInputStable,
      startThread,
      state.activeThreadId,
      state.activeTurnId,
    ],
  )

  useThreadUrlSync({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    selectThread,
  })

  const runDevLoadAllStep = useCallback(() => {
    void loadEarlierHistory().catch(() => {
      resetDevLoadAllState()
    })
  }, [loadEarlierHistory, resetDevLoadAllState])

  useEffect(() => {
    if (!devRuntime) return
    if (!devLoadAllRequested) return

    if (!state.activeThreadId) {
      resetDevLoadAllState()
      return
    }

    if (activeHistoryLoading) {
      if (!devLoadAllSawHistoryLoading) {
        setDevLoadAllSawHistoryLoadingStable(true)
      }
      return
    }

    if (historyMore) {
      runDevLoadAllStep()
      return
    }

    if (devLoadAllBootstrapAttempts === 0) {
      setDevLoadAllBootstrapAttemptsStable(1)
      runDevLoadAllStep()
      return
    }

    if (devLoadAllBootstrapAttempts === 1 && devLoadAllSawHistoryLoading) {
      setDevLoadAllBootstrapAttemptsStable(2)
      runDevLoadAllStep()
      return
    }

    resetDevLoadAllState()
  }, [
    activeHistoryLoading,
    devLoadAllBootstrapAttempts,
    devLoadAllRequested,
    devLoadAllSawHistoryLoading,
    devRuntime,
    historyMore,
    runDevLoadAllStep,
    state.activeThreadId,
    setDevLoadAllBootstrapAttemptsStable,
    setDevLoadAllSawHistoryLoadingStable,
    resetDevLoadAllState,
  ])

  useDevRuntimeApi({
    dispatch,
    activeThreadId: state.activeThreadId,
    activeTurnId: state.activeTurnId,
    enabled: devRuntime,
    clientRef,
  })

  useRpcConnectionEffect({
    bridgeUrl,
    seenEventCap: SEEN_EVENT_CAP,
    dispatch,
    initializeHandshake,
    refreshThreads,
    refreshWorkspaceDiff,
    resumeThreadInputs,
    replayThreadEvents,
    activeThreadIdRef,
    handleNotification,
    captureError,
    onQueueMetrics: onRpcQueueMetrics,
    rpcQueueConfig,
    clientRef,
    eventCursorRef,
  })

  const runAsyncSafely = useCallback((task: Promise<unknown>) => {
    void task.catch(() => undefined)
  }, [])

  const threadUiHandlers = useMemo(
    () => ({
      onSelectCwd: selectCwd,
      onSelectThread: selectThread,
      onRenameThread: (threadId: string, label: string) => {
        runAsyncSafely(renameThread(threadId, label))
      },
      onArchiveThread: (threadId: string) => {
        runAsyncSafely(archiveThread(threadId))
      },
      onStartThread: () => {
        runAsyncSafely(startThread())
      },
      onStartThreadInCwd: (cwd: string) => {
        runAsyncSafely(startThreadInCwd(cwd))
      },
      onHideThreadGroup: (cwd: string) => {
        runAsyncSafely(hideThreadGroup(cwd))
      },
    }),
    [
      archiveThread,
      hideThreadGroup,
      renameThread,
      runAsyncSafely,
      selectCwd,
      selectThread,
      startThread,
      startThreadInCwd,
    ],
  )

  const composerUiHandlers = useMemo(
    () => ({
      onModeChange: (nextMode: ReplMode) => {
        setModeStable(nextMode)
        cacheThreadMode(activeThreadIdRef.current, nextMode)
      },
      onSend,
      onInterrupt: () => {
        runAsyncSafely(interruptTurn())
      },
      onLoadEarlier: () => {
        runAsyncSafely(loadEarlierHistory())
      },
      onSubmitInput: (inputId: string, answers: Record<string, string>) => {
        runAsyncSafely(submitInputById(inputId, answers))
      },
      onDevLoadAllEarlier: () => {
        if (!devRuntime) return
        if (!state.activeThreadId) return
        startDevLoadAllState()
      },
    }),
    [
      cacheThreadMode,
      devRuntime,
      interruptTurn,
      loadEarlierHistory,
      onSend,
      runAsyncSafely,
      setModeStable,
      startDevLoadAllState,
      state.activeThreadId,
      submitInputById,
    ],
  )

  const diffUiHandlers = useMemo(
    () => ({
      onRefreshDiff: () => {
        runAsyncSafely(refreshWorkspaceDiff())
      },
      onRequestDiffPatch: (filePath: string) => requestDiffFilePatch(filePath),
    }),
    [refreshWorkspaceDiff, requestDiffFilePatch, runAsyncSafely],
  )

  return {
    sortedThreads,
    selectedCwd,
    onSelectCwd: threadUiHandlers.onSelectCwd,
    activeThreadId: state.activeThreadId,
    onSelectThread: threadUiHandlers.onSelectThread,
    onRenameThread: threadUiHandlers.onRenameThread,
    onArchiveThread: threadUiHandlers.onArchiveThread,
    onStartThread: threadUiHandlers.onStartThread,
    onStartThreadInCwd: threadUiHandlers.onStartThreadInCwd,
    hiddenGroupCwds,
    onHideThreadGroup: threadUiHandlers.onHideThreadGroup,
    isThreadActionBusy,
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidth,
    rightRailWidth,
    setSidebarWidth,
    setRightRailWidth,
    activeThreadTitle,
    activeTurnId: state.activeTurnId,
    connectionStatus: state.connectionStatus,
    activeThread,
    transcriptVirtualizationEnabled,
    composerLocked,
    logs: activeLogs,
    inputText,
    mode,
    onModeChange: composerUiHandlers.onModeChange,
    onInputTextChange: setInputTextStable,
    onSend: composerUiHandlers.onSend,
    onInterrupt: composerUiHandlers.onInterrupt,
    historyMore,
    historyLoading: activeHistoryLoading,
    onLoadEarlier: composerUiHandlers.onLoadEarlier,
    devLoadAllEnabled: devRuntime,
    devLoadAllRunning: devLoadAllRequested,
    onDevLoadAllEarlier: composerUiHandlers.onDevLoadAllEarlier,
    isSending: isSendingTurn,
    isInterrupting: isInterruptingTurn,
    lastRpcError,
    selectedInput,
    isSelectedAskOpen,
    selectedAskPageIndex,
    selectedAskDraft,
    submitStatus,
    isSubmittingInput,
    onAskOpen,
    onAskDismiss,
    onAskPageChange,
    onAskDraftChange,
    onSubmitInput: composerUiHandlers.onSubmitInput,
    diffSnapshot,
    onRefreshDiff: diffUiHandlers.onRefreshDiff,
    onRequestDiffPatch: diffUiHandlers.onRequestDiffPatch,
    isRefreshingDiff,
    noticeMessage,
  }
}
