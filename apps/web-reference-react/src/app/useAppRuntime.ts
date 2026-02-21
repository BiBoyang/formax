import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RpcClient } from '../rpcClient'
import { appReducer, initialAppState } from '../store'
import type { RpcNotification, TranscriptItem } from '../types'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from '../turnEventCursor'
import { type DiffSnapshot } from '../components/WorktreeDiffPane'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import { parseThreadReplayResponse } from './core/rpcContracts'
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
import {
  formatArchiveNotice,
  resolveArchiveSelection,
  type ArchiveThreadLike,
} from '../semantics'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { processNotification } from './runtime/processNotification'
import { replayThreadEvents as runReplayThreadEvents } from './runtime/replayThreadEvents'
import { createComposerActions } from './runtime/composerActions'
import { createThreadActions } from './runtime/threadActions'
import type { SelectThreadOptions } from './runtime/threadActions'
import { usePendingInputUiState } from './runtime/usePendingInputUiState'
import { createThreadDataOps } from './runtime/threadDataOps'
import { connectRpcClient } from './runtime/connectRpcClient'
import { useThreadSelection } from './runtime/useThreadSelection'
import { useRuntimeRefSync } from './runtime/useRuntimeRefSync'
import { useRpcRequest } from './runtime/useRpcRequest'
import { useThreadModeCache } from './runtime/useThreadModeCache'
import { useInitializeHandshake } from './runtime/useInitializeHandshake'
import { pruneThreadScopedRefs } from './runtime/threadScopedRefs'
import { useDevRuntimeApi } from './runtime/useDevRuntimeApi'
import { useTranscriptDisplayState } from './runtime/useTranscriptDisplayState'
import { useThreadUrlSync } from './runtime/useThreadUrlSync'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
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
  const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } }
  return meta.env?.DEV === true
}

export function useAppRuntime(ports?: RuntimePorts): AppShellProps {
  const runtimePorts = useMemo(() => ports ?? createDefaultRuntimePorts(), [ports])
  const devRuntime = useMemo(() => isDevRuntime(), [])
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [inputText, setInputText] = useState('')
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const { isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth, rightRailWidth, setRightRailWidth } =
    usePaneLayout()
  const [mode, setMode] = useState<ReplMode>('normal')
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null)
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
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const eventCursorRef = useRef(createTurnEventCursorState(SEEN_EVENT_CAP))
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const transcriptSourceByThreadRef = useRef<Record<string, ThreadTranscriptSource>>({})
  const activeThreadIdRef = useRef<string | null>(state.activeThreadId)
  const selectedCwdRef = useRef<string | null>(selectedCwd)
  const threadsRef = useRef(state.threads)
  const selectedInputIdRef = useRef<string | null>(state.selectedInputId)
  const stateLogsRef = useRef<TranscriptItem[]>(state.logs)
  const logsByThreadIdRef = useRef<Record<string, TranscriptItem[]>>(logsByThreadId)
  const historyCursorByThreadIdRef = useRef<Record<string, string | null>>(historyCursorByThreadId)
  const replayCursorByThreadRef = useRef<Record<string, number>>({})
  const replayAnomalyCountSeenByThreadRef = useRef<Record<string, number>>({})
  const runtimeStateByThreadRef = useRef<Record<string, ThreadRuntimeState>>({})
  const pendingArchiveOpsRef = useRef<Map<string, { threadId: string; thread: ArchiveThreadLike | null }>>(new Map())
  const selectThreadRef = useRef<(threadId: string, options?: SelectThreadOptions) => void>(() => undefined)
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
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
    selectedCwdRef.current = selectedCwd
  }, [selectedCwd])

  useEffect(() => {
    threadsRef.current = state.threads
    pruneThreadScopedRuntimeRefs(state.threads)
  }, [pruneThreadScopedRuntimeRefs, state.threads])

  useEffect(() => {
    historyCursorByThreadIdRef.current = historyCursorByThreadId
  }, [historyCursorByThreadId])

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])
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
        setIsRefreshingDiff,
        setDiffSnapshot,
        setHistoryLoadingByThreadId,
        setHistoryCursorByThreadId,
        setTranscriptSourceByThreadId,
        setLogsByThreadId,
        resolveDiffCwd: () => {
          if (selectedCwdRef.current) return selectedCwdRef.current
          const activeThreadId = activeThreadIdRef.current
          if (!activeThreadId) return null
          return threadsRef.current.find((thread) => thread.id === activeThreadId)?.cwd ?? null
        },
      }),
    [log, request],
  )

  const handleThreadArchivedNotification = useCallback(
    (params: unknown) => {
      const event = params && typeof params === 'object' ? (params as Record<string, unknown>) : null
      const threadId = typeof event?.threadId === 'string' ? event.threadId.trim() : ''
      if (!threadId) return

      const opId = typeof event?.opId === 'string' ? event.opId.trim() : ''
      if (opId) {
        const tracked = pendingArchiveOpsRef.current.get(opId)
        if (tracked) {
          pendingArchiveOpsRef.current.delete(opId)
          pruneThreadScopedRuntimeRefs(threadsRef.current)
          setNoticeMessage(formatArchiveNotice(tracked.thread))
        }
      }

      const currentThreads = threadsRef.current
      if (!currentThreads.some((thread) => thread.id === threadId)) return
      const nextThreads = currentThreads.filter((thread) => thread.id !== threadId)
      dispatch({ type: 'set_threads', threads: nextThreads })

      if (activeThreadIdRef.current !== threadId) return

      const orderedThreadIds = [...currentThreads]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((thread) => thread.id)
      const selection = resolveArchiveSelection({
        activeThreadId: threadId,
        archivedThreadId: threadId,
        orderedThreadIds,
      })
      if (selection.nextActiveThreadId) {
        selectThreadRef.current(selection.nextActiveThreadId, { restoreOnReplayFailure: false })
        return
      }

      activeThreadIdRef.current = null
      setMode('normal')
      dispatch({ type: 'set_active_thread', threadId: null })
      dispatch({ type: 'set_active_turn', turnId: null })
      dispatch({ type: 'clear_pending_inputs' })
      dispatch({ type: 'replace_logs', logs: [] })
      setSelectedCwd(null)
      void refreshWorkspaceDiff(null).catch(() => undefined)
    },
    [dispatch, pruneThreadScopedRuntimeRefs, refreshWorkspaceDiff, setSelectedCwd],
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
      cacheThreadMode,
      devPerfEnabled,
      handleThreadArchivedNotification,
      log,
      refreshThreads,
      refreshWorkspaceDiff,
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
      request,
      cacheThreadMode,
      clearThreadHistoryCursor,
      loadThreadHistory,
      handleNotification,
      log,
      parseThreadReplayResponse,
      setThreadTranscriptSource,
      syncPendingInputsFromReplayState,
    ],
  )

  useRuntimeRefSync({
    activeThreadId: state.activeThreadId,
    logs: state.logs,
    selectedInputId: state.selectedInputId,
    logsByThreadId,
    activeThreadIdRef,
    stateLogsRef,
    selectedInputIdRef,
    logsByThreadIdRef,
    setLogsByThreadId,
  })

  useEffect(() => {
    return connectRpcClient({
      bridgeUrl,
      seenEventCap: SEEN_EVENT_CAP,
      dispatch,
      clientRef,
      eventCursorRef,
      initializeHandshake,
      refreshThreads,
      refreshWorkspaceDiff,
      resumeThreadInputs,
      replayThreadEvents,
      activeThreadIdRef,
      handleNotification,
      captureError,
    })
  }, [
    bridgeUrl,
    captureError,
    handleNotification,
    initializeHandshake,
    refreshThreads,
    refreshWorkspaceDiff,
    replayThreadEvents,
    resumeThreadInputs,
  ])

  const { sortedThreads } = useThreadSelection({
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    selectedCwd,
    setSelectedCwd,
  })

  const { startThread, selectThread, selectCwd, renameThread, archiveThread, loadEarlierHistory } = useMemo(
    () =>
      createThreadActions({
        selectedCwd,
        setSelectedCwd,
        state: {
          activeThreadId: state.activeThreadId,
          activeTurnId: state.activeTurnId,
          selectedInputId: state.selectedInputId,
          pendingInputs: state.pendingInputs,
          logs: state.logs,
          threads: state.threads,
        },
        sortedThreads,
        logsByThreadId,
        request,
        dispatch,
        log,
        setMode,
        runtimeStateByThreadRef,
        replayCursorByThreadRef,
        activeThreadIdRef,
        setIsThreadActionBusy,
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
      logsByThreadId,
      refreshThreads,
      refreshWorkspaceDiff,
      replayThreadEvents,
      request,
      resumeThreadInputs,
      selectedCwd,
      pruneThreadScopedRuntimeRefs,
      sortedThreads,
      state.activeThreadId,
      state.activeTurnId,
      state.selectedInputId,
      state.logs,
      state.pendingInputs,
      state.threads,
    ],
  )

  useEffect(() => {
    selectThreadRef.current = selectThread
  }, [selectThread])

  useEffect(() => {
    if (!noticeMessage) return
    const timer = window.setTimeout(() => setNoticeMessage(null), 2600)
    return () => window.clearTimeout(timer)
  }, [noticeMessage])

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () =>
      createComposerActions({
        inputText,
        setInputText,
        isSendingTurn,
        isInterruptingTurn,
        isSubmittingInput,
        mode,
        activeThreadId: state.activeThreadId,
        activeTurnId: state.activeTurnId,
        resolveRequestCwd: (threadId) => {
          const activeThread = state.threads.find((thread) => thread.id === threadId)
          return selectedCwd ?? activeThread?.cwd ?? null
        },
        getPendingInputById: (inputId) => state.pendingInputs[inputId],
        request,
        dispatch,
        log,
        commandByTurnRef,
        setIsSendingTurn,
        setIsInterruptingTurn,
        setIsSubmittingInput,
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
      selectedCwd,
      startThread,
      state.activeThreadId,
      state.activeTurnId,
      state.threads,
      state.pendingInputs,
    ],
  )

  useThreadUrlSync({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    selectThread,
  })

  useDevRuntimeApi({
    dispatch,
    activeThreadId: state.activeThreadId,
    activeTurnId: state.activeTurnId,
    enabled: devRuntime,
  })

  return {
    sortedThreads,
    selectedCwd,
    onSelectCwd: selectCwd,
    activeThreadId: state.activeThreadId,
    onSelectThread: selectThread,
    onRenameThread: (threadId, label) => void renameThread(threadId, label),
    onArchiveThread: (threadId) => void archiveThread(threadId),
    onStartThread: () => void startThread().catch(() => undefined),
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
    onModeChange: (nextMode) => {
      setMode(nextMode)
      cacheThreadMode(activeThreadIdRef.current, nextMode)
    },
    onInputTextChange: setInputText,
    onSend,
    onInterrupt: () => void interruptTurn().catch(() => undefined),
    historyMore,
    historyLoading: activeHistoryLoading,
    onLoadEarlier: () => void loadEarlierHistory().catch(() => undefined),
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
    onSubmitInput: (inputId, answers) => void submitInputById(inputId, answers).catch(() => undefined),
    diffSnapshot,
    onRefreshDiff: () => void refreshWorkspaceDiff().catch(() => undefined),
    onRequestDiffPatch: (filePath) => requestDiffFilePatch(filePath),
    isRefreshingDiff,
    noticeMessage,
  }
}
