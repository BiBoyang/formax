import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RpcClient } from '../rpcClient'
import { appReducer, initialAppState } from '../store'
import type { RpcNotification, TranscriptItem } from '../types'
import { formatToolInputAsParamsText } from '../toolEventNormalizer'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from '../turnEventCursor'
import { type DiffSnapshot } from '../components/WorktreeDiffPane'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import {
  asThreadReplay,
} from './core/rpcParsers'
import {
  type ThreadTranscriptSource,
} from './core/replayMachine'
import {
  displayThreadTitle,
  summarizeToolEvent,
  toRpcError,
  toRuntimePendingInputsById,
  toToolUseId,
  toTurnFooterStatus,
} from './core/threadTransforms'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { processNotification } from './runtime/processNotification'
import { replayThreadEvents as runReplayThreadEvents } from './runtime/replayThreadEvents'
import { createComposerActions } from './runtime/composerActions'
import { createThreadActions } from './runtime/threadActions'
import { usePendingInputUiState } from './runtime/usePendingInputUiState'
import { createThreadDataOps } from './runtime/threadDataOps'
import { connectRpcClient } from './runtime/connectRpcClient'
import { useThreadSelection } from './runtime/useThreadSelection'
import { useRuntimeRefSync } from './runtime/useRuntimeRefSync'
import { useRpcRequest } from './runtime/useRpcRequest'
import { useCanonicalMeta } from './runtime/useCanonicalMeta'
import { useThreadModeCache } from './runtime/useThreadModeCache'
import { useInitializeHandshake } from './runtime/useInitializeHandshake'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../../../../src/features/semantics/threadRuntimeState'
import { isReplMode, type ReplMode } from '../../../../src/features/semantics/replModeTransition'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const fromRuntimeConfig = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim()) {
    return fromRuntimeConfig
  }
  return DEFAULT_BRIDGE_URL
}

export function useAppRuntime(ports?: RuntimePorts): AppShellProps {
  const runtimePorts = useMemo(() => ports ?? createDefaultRuntimePorts(), [ports])
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [inputText, setInputText] = useState('')
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const { isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth, rightRailWidth, setRightRailWidth } =
    usePaneLayout()
  const [mode, setMode] = useState<ReplMode>('normal')
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null)
  const [logsByThreadId, setLogsByThreadId] = useState<Record<string, TranscriptItem[]>>({})
  const [historyCursorByThreadId, setHistoryCursorByThreadId] = useState<Record<string, string | null>>({})
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})
  const [transcriptSourceByThreadId, setTranscriptSourceByThreadId] = useState<Record<string, ThreadTranscriptSource>>({})
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const eventCursorRef = useRef(createTurnEventCursorState(SEEN_EVENT_CAP))
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const transcriptSourceByThreadRef = useRef<Record<string, ThreadTranscriptSource>>({})
  const activeThreadIdRef = useRef<string | null>(state.activeThreadId)
  const selectedInputIdRef = useRef<string | null>(state.selectedInputId)
  const stateLogsRef = useRef<TranscriptItem[]>(state.logs)
  const logsByThreadIdRef = useRef<Record<string, TranscriptItem[]>>(logsByThreadId)
  const replayCursorByThreadRef = useRef<Record<string, number>>({})
  const runtimeStateByThreadRef = useRef<Record<string, ThreadRuntimeState>>({})
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeTranscriptSource =
    state.activeThreadId != null ? transcriptSourceByThreadId[state.activeThreadId] ?? null : null
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])
  const { lastRpcError, captureError, request } = useRpcRequest({ clientRef, log })
  const { toCanonicalMeta } = useCanonicalMeta({
    activeThreadIdRef,
    nowIso: runtimePorts.nowIso,
  })
  const { cacheThreadMode } = useThreadModeCache({
    runtimeStateByThreadRef,
    nowIso: runtimePorts.nowIso,
  })
  const { initializeHandshake } = useInitializeHandshake({ clientRef })

  const shouldProcessSequencedNotification = useCallback(
    (params: any): boolean => {
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
        transcriptSourceByThreadRef,
        seenStaleInputIdRef,
        setIsRefreshingDiff,
        setDiffSnapshot,
        setHistoryLoadingByThreadId,
        setHistoryCursorByThreadId,
        setTranscriptSourceByThreadId,
        setLogsByThreadId,
      }),
    [log, request],
  )

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      processNotification(notification, {
        runtimeStateByThreadRef,
        replayCursorByThreadRef,
        activeThreadIdRef,
        commandByTurnRef,
        createInitialThreadRuntimeState,
        shouldProcessSequencedNotification,
        toCanonicalMeta,
        dispatch,
        setMode,
        cacheThreadMode,
        isReplMode,
        refreshThreads,
        refreshWorkspaceDiff,
        summarizeToolEvent,
        toToolUseId,
        toTurnFooterStatus,
        formatToolInputAsParamsText,
        log,
        setAskDockOpenByInputId,
        setAskPageIndexByInputId,
        setAskDraftByInputId,
        setSubmitStatusByInputId,
        reduceThreadRuntimeState,
      })
    },
    [cacheThreadMode, log, refreshThreads, refreshWorkspaceDiff, shouldProcessSequencedNotification, toCanonicalMeta],
  )

  const replayThreadEvents = useCallback(
    async (threadId: string, options?: { fromStart?: boolean }): Promise<boolean> => {
      return runReplayThreadEvents(threadId, options, {
        request,
        asThreadReplay,
        toRuntimePendingInputsById,
        replayCursorByThreadRef,
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
      })
    },
    [
      request,
      cacheThreadMode,
      clearThreadHistoryCursor,
      loadThreadHistory,
      handleNotification,
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

  const { startThread, selectThread, selectCwd, renameThread, loadEarlierHistory } = useMemo(
    () =>
      createThreadActions({
        selectedCwd,
        setSelectedCwd,
        state: {
          activeThreadId: state.activeThreadId,
          activeTurnId: state.activeTurnId,
          logs: state.logs,
          threads: state.threads,
        },
        sortedThreads,
        logsByThreadId,
        historyCursorByThreadId,
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
        loadEarlierHistoryAction,
      }),
    [
      historyCursorByThreadId,
      log,
      logsByThreadId,
      refreshThreads,
      refreshWorkspaceDiff,
      replayThreadEvents,
      request,
      resumeThreadInputs,
      selectedCwd,
      sortedThreads,
      state.activeThreadId,
      state.activeTurnId,
      state.logs,
      state.threads,
    ],
  )

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () =>
      createComposerActions({
        inputText,
        setInputText,
        isSendingTurn,
        isInterruptingTurn,
        isSubmittingInput,
        mode,
        selectedCwd,
        state: {
          activeThreadId: state.activeThreadId,
          activeTurnId: state.activeTurnId,
          threads: state.threads,
          pendingInputs: state.pendingInputs,
        },
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
      state.pendingInputs,
      state.threads,
    ],
  )

  const activeThread = useMemo(
    () => state.threads.find((t) => t.id === state.activeThreadId),
    [state.threads, state.activeThreadId],
  )
  const activeThreadTitle = displayThreadTitle(activeThread)
  return {
    sortedThreads,
    selectedCwd,
    onSelectCwd: selectCwd,
    activeThreadId: state.activeThreadId,
    onSelectThread: selectThread,
    onRenameThread: (threadId, label) => void renameThread(threadId, label),
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
    historyMore: Boolean(state.activeThreadId && activeTranscriptSource === 'history' && historyCursorByThreadId[state.activeThreadId]),
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
    isRefreshingDiff,
  }
}
