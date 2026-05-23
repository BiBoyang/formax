import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { appReducer, initialAppState } from '../store'
import type { RpcClientQueueMetrics } from '../rpcClient'
import { shouldAcceptSequencedNotification } from '../turnEventCursor'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import { resolveRpcQueueRuntimeConfig } from './core/rpcQueueConfig'
import { parseThreadGroupHideResponse } from './core/rpcContracts'
import {
  toRpcError,
} from './core/threadTransforms'
import { isTranscriptVirtualizationEnabled } from './core/transcriptVirtualization'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { applyRpcQueueMetricsDelta } from './runtime/rpcQueueMetrics'
import type { SelectThreadOptions } from './runtime/threadActions'
import { usePendingInputUiState } from './runtime/usePendingInputUiState'
import { createThreadDataOps } from './runtime/threadDataOps'
import { createDiffDataOps } from './runtime/diffDataOps'
import { createThreadUiHandlers } from './runtime/threadUiHandlers'
import { createComposerUiHandlers } from './runtime/composerUiHandlers'
import { createDiffUiHandlers } from './runtime/diffUiHandlers'
import { runAsyncSafely } from './runtime/runAsyncSafely'
import { useRuntimeViewState } from './runtime/useRuntimeViewState'
import { useRuntimeEventOrchestrator } from './runtime/useRuntimeEventOrchestrator'
import { useRuntimeActionsBundle } from './runtime/useRuntimeActionsBundle'
import { buildAppShellProps, type BuildAppShellPropsArgs } from './runtime/buildAppShellProps'
import { selectActiveContextMeterView } from './core/contextMeterSelectors'
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
import { useDevLoadAllHistory } from './runtime/useDevLoadAllHistory'
import { useTranscriptDisplayState } from './runtime/useTranscriptDisplayState'
import { useThreadUrlSync } from './runtime/useThreadUrlSync'
import { useUserSettings } from './runtime/useUserSettings'
import {
  type ArchiveThreadLike,
} from '../semantics'
import {
  isDevPerformanceEnabled,
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

export function useAppRuntime(ports?: RuntimePorts): AppShellProps {
  const runtimePorts = useMemo(() => ports ?? createDefaultRuntimePorts(), [ports])
  const devRuntime = useMemo(() => isDevRuntime(), [])
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [rpcQueueConfig] = useState(resolveRpcQueueRuntimeConfig)
  const [runtimeUi, setRuntimeUi] = useState({ showContextMeter: true })
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const { isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth, isRightRailOpen, setIsRightRailOpen, rightRailWidth, setRightRailWidth, isSettingsOpen, setIsSettingsOpen } =
    usePaneLayout()
  const { userSettings, updateUserSetting } = useUserSettings()
  const {
    inputText,
    diffSnapshot,
    isThreadActionBusy,
    isSendingTurn,
    isInterruptingTurn,
    isSubmittingInput,
    isRefreshingDiff,
    noticeMessage,
    mode,
    selectedCwd,
    hiddenGroupCwds,
    logsByThreadId,
    latestCompactBoundaryByThreadId,
    durableSnipByThreadId,
    latestRequestCollapseByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    setDiffSnapshot,
    setHistoryLoadingByThreadId,
    setInputTextStable,
    setIsThreadActionBusyStable,
    setIsSendingTurnStable,
    setIsInterruptingTurnStable,
    setIsSubmittingInputStable,
    setIsRefreshingDiffStable,
    setModeStable,
    setSelectedCwdStable,
    setNoticeMessageStable,
    setHiddenGroupCwdsStable,
    setLogsByThreadId,
    setHistoryCursorByThreadId,
    setTranscriptSourceByThreadId,
    setLatestCompactBoundaryByThreadId,
    setDurableSnipByThreadId,
    setLatestRequestCollapseByThreadId,
  } = useRuntimeViewState()

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
  const threadCacheRefs = useThreadCacheRefs(
    logsByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    durableSnipByThreadId,
    latestRequestCollapseByThreadId,
  )
  const threadRuntimeRefs = useThreadRuntimeRefs()

  // 展开使用（如果需要）
  const { clientRef, eventCursorRef, commandByTurnRef } = rpcRefs
  const { activeThreadIdRef, threadsRef, selectedCwdRef, selectedInputIdRef, stateLogsRef } = threadSnapshotRefs
  const { historyLoadTokenRef, historyLoadSeqByThreadRef, historyLoadingRef, historyCursorByThreadIdRef } = historyRefs
  const { logsByThreadIdRef, transcriptSourceByThreadRef, latestCompactBoundaryByThreadIdRef, durableSnipByThreadIdRef, latestRequestCollapseByThreadIdRef } = threadCacheRefs
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
    activeThreadLatestCompactBoundary,
    activeThreadLatestRequestCollapse,
    historyMore,
  } = useTranscriptDisplayState({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    logs: state.logs,
    logsByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    latestRequestCollapseByThreadId,
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
      applyRpcQueueMetricsDelta({ metrics, metricsRef: rpcQueueMetricsRef, log })
    },
    [log],
  )
  const { lastRpcError, captureError, request } = useRpcRequest({ clientRef, log })
  const { cacheThreadMode } = useThreadModeCache({
    runtimeStateByThreadRef,
    nowIso: runtimePorts.nowIso,
  })
  const onInitializeResult = useCallback((result: { ui: { showContextMeter: boolean } }) => {
    setRuntimeUi((previous) =>
      previous.showContextMeter === result.ui.showContextMeter
        ? previous
        : { showContextMeter: result.ui.showContextMeter },
    )
  }, [])
  const { initializeHandshake } = useInitializeHandshake({ clientRef, onInitializeResult })

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
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef,
        latestRequestCollapseByThreadIdRef,
        logsByThreadIdRef,
        stateLogsRef,
        seenStaleInputIdRef,
        setHistoryLoadingByThreadId,
        setHistoryCursorByThreadId,
        setTranscriptSourceByThreadId,
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId,
        setLatestRequestCollapseByThreadId,
        setLogsByThreadId,
        setHiddenGroupCwds: setHiddenGroupCwdsStable,
      }),
    [log, request, setDurableSnipByThreadId, setHiddenGroupCwdsStable, setLatestRequestCollapseByThreadId],
  )

  const { refreshWorkspaceDiff, requestDiffFilePatch } = useMemo(
    () =>
      createDiffDataOps({
        request,
        setIsRefreshingDiff: setIsRefreshingDiffStable,
        setDiffSnapshot,
        resolveDiffCwd: () => {
          const activeThreadId = activeThreadIdRef.current
          if (activeThreadId) {
            const activeThreadCwd = threadsRef.current.find((thread) => thread.id === activeThreadId)?.cwd ?? null
            if (activeThreadCwd) return activeThreadCwd
          }
          if (selectedCwdRef.current) return selectedCwdRef.current
          return null
        },
      }),
    [request, setIsRefreshingDiffStable],
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

  const { handleNotification, replayThreadEvents } = useRuntimeEventOrchestrator({
    devPerfEnabled,
    request,
    dispatch,
    log,
    cacheThreadMode,
    refreshThreads,
    refreshWorkspaceDiff,
    setMode: setModeStable,
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
    archivedHandlerDeps: {
      pruneThreadScopedRuntimeRefs,
      setNoticeMessage: setNoticeMessageStable,
      setSelectedCwd: setSelectedCwdStable,
      selectThreadRef,
      threadsRef,
      pendingArchiveOpsRef,
    },
  })

  const { sortedThreads } = useThreadSelection({
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    selectedCwd,
    setSelectedCwd: setSelectedCwdStable,
  })
  const sortedThreadsRef = useRef(sortedThreads)
  const activeContextMeter = useMemo(() => selectActiveContextMeterView(state), [state])

  useRuntimeRefSync({
    activeThreadId: state.activeThreadId,
    activeTurnId: state.activeTurnId,
    activeTurnIdRef,
    pendingInputs: state.pendingInputs,
    pendingInputsRef,
    sortedThreads,
    sortedThreadsRef,
    logs: state.logs,
    logsByThreadId,
    logsByThreadIdRef,
    setLogsByThreadId,
  })

  const {
    startThread,
    startThreadInCwd,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
    interruptTurn,
    submitInputById,
    onSend,
  } = useRuntimeActionsBundle({
    core: {
      request,
      dispatch,
      log,
    },
    thread: {
      selectedCwdRef,
      setSelectedCwd: setSelectedCwdStable,
      activeThreadIdRef,
      activeTurnIdRef,
      selectedInputIdRef,
      pendingInputsRef,
      stateLogsRef,
      threadsRef,
      sortedThreadsRef,
      logsByThreadIdRef,
      runtimeStateByThreadRef,
      replayCursorByThreadRef,
      setMode: setModeStable,
      setIsThreadActionBusy: setIsThreadActionBusyStable,
      replayThreadEvents,
      resumeThreadInputs,
      refreshThreads,
      refreshWorkspaceDiff,
      pendingArchiveOpsRef,
      pruneThreadScopedRuntimeRefs,
      loadEarlierHistoryAction,
      selectThreadRef,
    },
    composer: {
      inputText,
      setInputText: setInputTextStable,
      isSendingTurn,
      isInterruptingTurn,
      isSubmittingInput,
      mode,
      activeThreadId: state.activeThreadId,
      activeTurnId: state.activeTurnId,
      commandByTurnRef,
      setIsSendingTurn: setIsSendingTurnStable,
      setIsInterruptingTurn: setIsInterruptingTurnStable,
      setIsSubmittingInput: setIsSubmittingInputStable,
      setSubmitStatusByInputId,
      toRpcError,
      nowMs: runtimePorts.nowMs,
    },
  })

  useThreadUrlSync({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    selectThread,
  })

  const { running: devLoadAllRunning, requestStart: requestDevLoadAll } = useDevLoadAllHistory({
    enabled: devRuntime,
    activeThreadId: state.activeThreadId,
    activeHistoryLoading,
    historyMore,
    loadEarlierHistory,
  })

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

  const threadUiHandlers = useMemo(
    () =>
      createThreadUiHandlers({
        selectCwd,
        selectThread,
        renameThread,
        archiveThread,
        startThread,
        startThreadInCwd,
        hideThreadGroup,
        runAsyncSafely,
      }),
    [
      archiveThread,
      hideThreadGroup,
      renameThread,
      selectCwd,
      selectThread,
      startThread,
      startThreadInCwd,
    ],
  )

  const composerUiHandlers = useMemo(
    () =>
      createComposerUiHandlers({
        setMode: setModeStable,
        cacheThreadMode,
        activeThreadIdRef,
        onSend,
        interruptTurn,
        loadEarlierHistory,
        submitInputById,
        requestDevLoadAll,
        runAsyncSafely,
      }),
    [
      cacheThreadMode,
      interruptTurn,
      loadEarlierHistory,
      onSend,
      requestDevLoadAll,
      setModeStable,
      submitInputById,
    ],
  )

  const diffUiHandlers = useMemo(
    () =>
      createDiffUiHandlers({
        refreshWorkspaceDiff,
        requestDiffFilePatch,
        runAsyncSafely,
      }),
    [refreshWorkspaceDiff, requestDiffFilePatch],
  )

  const threadSection = useMemo<BuildAppShellPropsArgs['thread']>(
    () => ({
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
    }),
    [hiddenGroupCwds, isThreadActionBusy, selectedCwd, sortedThreads, state.activeThreadId, threadUiHandlers],
  )

  const layoutSection = useMemo<BuildAppShellPropsArgs['layout']>(
    () => ({
      isSidebarOpen,
      setIsSidebarOpen,
      sidebarWidth,
      isRightRailOpen,
      setIsRightRailOpen,
      rightRailWidth,
      setSidebarWidth,
      setRightRailWidth,
      isSettingsOpen,
      setIsSettingsOpen,
    }),
    [isSidebarOpen, rightRailWidth, setIsSidebarOpen, isRightRailOpen, setIsRightRailOpen, setRightRailWidth, setSidebarWidth, sidebarWidth, isSettingsOpen, setIsSettingsOpen],
  )

  const transcriptSection = useMemo<BuildAppShellPropsArgs['transcript']>(
    () => ({
      activeThreadTitle,
      activeThreadLatestCompactBoundary,
      activeThreadLatestRequestCollapse,
      activeContextMeter,
      showContextMeter: runtimeUi.showContextMeter,
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
      devLoadAllRunning,
      onDevLoadAllEarlier: composerUiHandlers.onDevLoadAllEarlier,
      isSending: isSendingTurn,
      isInterrupting: isInterruptingTurn,
      lastRpcError,
    }),
    [
      activeHistoryLoading,
      activeLogs,
      activeThread,
      activeThreadLatestCompactBoundary,
      activeThreadLatestRequestCollapse,
      activeContextMeter,
      activeThreadTitle,
      composerLocked,
      composerUiHandlers,
      devLoadAllRunning,
      devRuntime,
      historyMore,
      inputText,
      isInterruptingTurn,
      isSendingTurn,
      lastRpcError,
      mode,
      runtimeUi.showContextMeter,
      setInputTextStable,
      state.activeTurnId,
      state.connectionStatus,
      transcriptVirtualizationEnabled,
    ],
  )

  const approvalSection = useMemo<BuildAppShellPropsArgs['approval']>(
    () => ({
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
    }),
    [
      composerUiHandlers,
      isSelectedAskOpen,
      isSubmittingInput,
      onAskDismiss,
      onAskDraftChange,
      onAskOpen,
      onAskPageChange,
      selectedAskDraft,
      selectedAskPageIndex,
      selectedInput,
      submitStatus,
    ],
  )

  const diffSection = useMemo<BuildAppShellPropsArgs['diff']>(
    () => ({
      diffSnapshot,
      onRefreshDiff: diffUiHandlers.onRefreshDiff,
      onRequestDiffPatch: diffUiHandlers.onRequestDiffPatch,
      isRefreshingDiff,
    }),
    [diffSnapshot, diffUiHandlers, isRefreshingDiff],
  )

  const feedbackSection = useMemo<BuildAppShellPropsArgs['feedback']>(
    () => ({ noticeMessage }),
    [noticeMessage],
  )

  const settingsSection = useMemo<BuildAppShellPropsArgs['settings']>(
    () => ({
      userSettings,
      onUserSettingChange: updateUserSetting,
    }),
    [updateUserSetting, userSettings],
  )

  return useMemo(
    () =>
      buildAppShellProps({
        thread: threadSection,
        layout: layoutSection,
        transcript: transcriptSection,
        approval: approvalSection,
        diff: diffSection,
        feedback: feedbackSection,
        settings: settingsSection,
      }),
    [
      approvalSection,
      diffSection,
      feedbackSection,
      layoutSection,
      settingsSection,
      threadSection,
      transcriptSection,
    ],
  )
}
