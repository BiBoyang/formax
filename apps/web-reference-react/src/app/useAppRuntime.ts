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
import {
  asThreadReplay,
} from './core/rpcParsers'
import {
  type ThreadTranscriptSource,
} from './core/replayMachine'
import {
  displayThreadTitle,
  toRpcError,
  toRuntimePendingInputsById,
} from './core/threadTransforms'
import {
  formatArchiveNotice,
  resolveArchiveSelection,
  type ArchiveThreadLike,
} from '../../../../src/features/semantics/runtime/threadArchiveSemantics'
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
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../../../../src/features/semantics/runtime/threadRuntimeState'
import { isReplMode, type ReplMode } from '../../../../src/features/semantics/core/replModeTransition'

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

const THREAD_QUERY_PARAM = 'thread'

function readThreadIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const raw = new URL(window.location.href).searchParams.get(THREAD_QUERY_PARAM)
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

function replaceThreadIdInUrl(threadId: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const current = url.searchParams.get(THREAD_QUERY_PARAM)
  if (threadId) {
    if (current === threadId) return
    url.searchParams.set(THREAD_QUERY_PARAM, threadId)
  } else {
    if (!current) return
    url.searchParams.delete(THREAD_QUERY_PARAM)
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
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
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
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
  const selectedCwdRef = useRef<string | null>(selectedCwd)
  const threadsRef = useRef(state.threads)
  const selectedInputIdRef = useRef<string | null>(state.selectedInputId)
  const stateLogsRef = useRef<TranscriptItem[]>(state.logs)
  const logsByThreadIdRef = useRef<Record<string, TranscriptItem[]>>(logsByThreadId)
  const replayCursorByThreadRef = useRef<Record<string, number>>({})
  const replayAnomalyCountSeenByThreadRef = useRef<Record<string, number>>({})
  const runtimeStateByThreadRef = useRef<Record<string, ThreadRuntimeState>>({})
  const pendingArchiveOpsRef = useRef<Map<string, { threadId: string; thread: ArchiveThreadLike | null }>>(new Map())
  const selectThreadRef = useRef<(threadId: string, options?: SelectThreadOptions) => void>(() => undefined)
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const hasInitializedThreadFromUrlRef = useRef(false)
  const pendingThreadIdFromUrlRef = useRef<string | null>(null)
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeTranscriptSource =
    state.activeThreadId != null ? transcriptSourceByThreadId[state.activeThreadId] ?? null : null
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs

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
        transcriptSourceByThreadRef,
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
      })
    },
    [
      cacheThreadMode,
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
        asThreadReplay,
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
      historyCursorByThreadId,
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

  useEffect(() => {
    if (hasInitializedThreadFromUrlRef.current) return
    const threadIdFromUrl = readThreadIdFromUrl()
    if (!threadIdFromUrl) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (state.activeThreadId === threadIdFromUrl) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (state.activeThreadId) {
      hasInitializedThreadFromUrlRef.current = true
      return
    }
    if (state.threads.length === 0) return
    const matched = state.threads.some((thread) => thread.id === threadIdFromUrl)
    hasInitializedThreadFromUrlRef.current = true
    if (!matched) {
      replaceThreadIdInUrl(null)
      return
    }
    pendingThreadIdFromUrlRef.current = threadIdFromUrl
    selectThread(threadIdFromUrl)
  }, [selectThread, state.activeThreadId, state.threads])

  useEffect(() => {
    if (!hasInitializedThreadFromUrlRef.current) return
    const pending = pendingThreadIdFromUrlRef.current
    if (pending) {
      if (state.activeThreadId === pending) {
        pendingThreadIdFromUrlRef.current = null
      } else if (!state.activeThreadId) {
        return
      } else {
        pendingThreadIdFromUrlRef.current = null
      }
    }
    replaceThreadIdInUrl(state.activeThreadId)
  }, [state.activeThreadId])

  useEffect(() => {
    if (!isDevRuntime() || typeof window === 'undefined') return
    type DevApiWindow = Window & {
      __formaxDevAskUserQuestion?: (overrides?: {
        inputId?: string
        threadId?: string
        turnId?: string
        toolUseId?: string
      }) => string
      __formaxDevClearPendingInputs?: () => void
    }

    const devWindow = window as DevApiWindow
    devWindow.__formaxDevAskUserQuestion = (overrides) => {
      const now = Date.now()
      const inputId = overrides?.inputId ?? `dev-ask-${now}`
      const threadId = overrides?.threadId ?? state.activeThreadId ?? 'dev-thread'
      const turnId = overrides?.turnId ?? state.activeTurnId ?? `dev-turn-${now}`
      const toolUseId = overrides?.toolUseId ?? `dev-tool-ask-${now}`
      const createdAt = new Date(now).toISOString()
      const expiresAt = new Date(now + 10 * 60 * 1000).toISOString()

      dispatch({
        type: 'input_requested',
        input: {
          inputId,
          threadId,
          turnId,
          toolUseId,
          kind: 'ask_user_question',
          status: 'pending',
          createdAt,
          expiresAt,
          payload: {
            questions: [
              {
                header: 'Coding Time',
                question: '你平时更喜欢在什么时间写代码？',
                fieldId: 'coding_time',
                options: [
                  { label: '清晨', description: '早上精力充沛，环境安静' },
                  { label: '下午', description: '白天工作时间' },
                  { label: '深夜', description: '夜深人静时专注力高' },
                ],
                multiSelect: false,
              },
              {
                header: 'Review Depth',
                question: '这次希望我把 review 做到什么深度？',
                fieldId: 'review_depth',
                options: [
                  { label: '只看 blocker', description: '只看会阻塞发布的问题' },
                  { label: '常规完整', description: '覆盖中高优先级问题' },
                  { label: '尽可能严格', description: '包括低优先级潜在风险' },
                ],
                multiSelect: false,
              },
              {
                header: 'Output Style',
                question: '你更偏好哪种回复风格？',
                fieldId: 'output_style',
                options: [
                  { label: '短答案', description: '结论优先，简洁输出' },
                  { label: '带解释', description: '给出简短原因和取舍' },
                  { label: '详细展开', description: '附上下文、步骤和风险点' },
                ],
                multiSelect: false,
              },
            ],
          },
        },
      })
      dispatch({ type: 'set_selected_input', inputId })
      return inputId
    }

    devWindow.__formaxDevClearPendingInputs = () => {
      dispatch({ type: 'clear_pending_inputs' })
    }

    return () => {
      delete devWindow.__formaxDevAskUserQuestion
      delete devWindow.__formaxDevClearPendingInputs
    }
  }, [dispatch, state.activeThreadId, state.activeTurnId])

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
    onRequestDiffPatch: (filePath) => requestDiffFilePatch(filePath),
    isRefreshingDiff,
    noticeMessage,
  }
}
