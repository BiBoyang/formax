import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { appReducer, initialAppState } from '../store'
import type { RpcNotification, TranscriptItem } from '../types'
import { shouldAcceptSequencedNotification } from '../turnEventCursor'
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

  const handleThreadArchivedNotification = useMemo(
    () => createThreadArchivedHandler({
      dispatch,
      pruneThreadScopedRuntimeRefs,
      refreshWorkspaceDiff,
      setNoticeMessage,
      setSelectedCwd,
      selectThreadRef, // 传 ref 本身，不是 current
      setMode,
      threadsRef,
      activeThreadIdRef,
      pendingArchiveOpsRef,
    }),
    [dispatch, pruneThreadScopedRuntimeRefs, refreshWorkspaceDiff, setNoticeMessage, setSelectedCwd, setMode],
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
    clientRef,
    eventCursorRef,
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
