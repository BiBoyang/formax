import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { RpcClient } from '../rpcClient'
import { appReducer, initialAppState } from '../store'
import type { RpcNotification, TranscriptItem } from '../types'
import { formatToolInputAsParamsText } from '../toolEventNormalizer'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from '../turnEventCursor'
import { type DiffSnapshot } from '../components/WorktreeDiffPane'
import { mapThreadHistoryToCanonicalLogs } from '../eventAdapters'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import {
  asResolvedInputs,
  asThreadMessages,
  asThreadReplay,
  asThreadSummaries,
  type ReplayStateSnapshot,
} from './core/rpcParsers'
import {
  buildAskUiStateFromPendingInputs,
  mapsAreShallowEqual,
  pruneMapByPendingIds,
  resolveSelectedInputId,
  toPendingInputIdSet,
} from './core/inputStateMachine'
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
  type RpcErrorDetails,
} from './core/threadTransforms'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { processNotification } from './runtime/processNotification'
import { replayThreadEvents as runReplayThreadEvents } from './runtime/replayThreadEvents'
import { createComposerActions } from './runtime/composerActions'
import { createThreadActions } from './runtime/threadActions'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../../../../src/features/semantics/threadRuntimeState'
import { isReplMode, type ReplMode } from '../../../../src/features/semantics/replModeTransition'
import {
  isCanonicalEventSource,
  type CanonicalEventSource,
} from '../../../../src/features/semantics/canonicalEvents'

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
  const [submitStatusByInputId, setSubmitStatusByInputId] = useState<
    Record<string, { status: string; kind: 'success' | 'error'; message?: string }>
  >({})
  const [lastRpcError, setLastRpcError] = useState<RpcErrorDetails | null>(null)
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const [askDockOpenByInputId, setAskDockOpenByInputId] = useState<Record<string, boolean>>({})
  const [askDraftByInputId, setAskDraftByInputId] = useState<Record<string, Record<string, string>>>({})
  const [askPageIndexByInputId, setAskPageIndexByInputId] = useState<Record<string, number>>({})
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
  const canonicalReplaySeqRef = useRef(0)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null
  const selectedAskDraft = selectedInput ? (askDraftByInputId[selectedInput.inputId] ?? {}) : {}
  const selectedAskPageIndex = selectedInput ? (askPageIndexByInputId[selectedInput.inputId] ?? 0) : 0
  const isSelectedAskOpen =
    selectedInput?.kind === 'ask_user_question' ? Boolean(askDockOpenByInputId[selectedInput.inputId] ?? true) : false
  const composerLocked =
    selectedInput != null &&
    (selectedInput.kind === 'approval' || (selectedInput.kind === 'ask_user_question' && isSelectedAskOpen))
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeTranscriptSource =
    state.activeThreadId != null ? transcriptSourceByThreadId[state.activeThreadId] ?? null : null
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])

  const cacheThreadMode = useCallback((threadId: string | null | undefined, nextMode: ReplMode) => {
    if (!threadId) return
    const existing = runtimeStateByThreadRef.current[threadId]
    if (existing) {
      if (existing.mode === nextMode) return
      runtimeStateByThreadRef.current[threadId] = {
        ...existing,
        mode: nextMode,
        updatedAt: runtimePorts.nowIso(),
      }
      return
    }
    const seed = createInitialThreadRuntimeState({
      threadId,
      replaySeq: 0,
      method: 'ui/modeSelected',
      ts: runtimePorts.nowIso(),
    })
    runtimeStateByThreadRef.current[threadId] = {
      ...seed,
      mode: nextMode,
    }
  }, [runtimePorts])

  const shouldProcessSequencedNotification = useCallback(
    (params: any): boolean => {
      return shouldAcceptSequencedNotification(eventCursorRef.current, params)
    },
    [],
  )

  const captureError = useCallback(
    (method: string, error: unknown) => {
      const details = toRpcError(method, error)
      setLastRpcError(details)
      log(`[${method}] ${details.message}${details.code != null ? ` (code ${details.code})` : ''}`, 'error')
      return details
    },
    [log],
  )

  const request = useCallback(
    async (method: string, params?: unknown): Promise<any> => {
      const client = clientRef.current
      if (!client) throw new Error('RPC client is not ready')
      try {
        return await client.request(method, params)
      } catch (error) {
        captureError(method, error)
        throw error
      }
    },
    [captureError],
  )

  const syncPendingInputsFromReplayState = useCallback(
    (threadId: string, replayState: ReplayStateSnapshot | null) => {
      if (activeThreadIdRef.current !== threadId) return
      const pendingInputs = replayState?.pendingInputs ?? []
      const pendingInputIdSet = new Set(pendingInputs.map((input) => input.inputId))
      const selectedInputIdBeforeSync = selectedInputIdRef.current

      dispatch({ type: 'clear_pending_inputs' })
      for (const input of pendingInputs) {
        dispatch({ type: 'input_requested', input })
      }
      if (selectedInputIdBeforeSync && pendingInputIdSet.has(selectedInputIdBeforeSync)) {
        dispatch({ type: 'set_selected_input', inputId: selectedInputIdBeforeSync })
      }

      setSubmitStatusByInputId((prev) => {
        if (Object.keys(prev).length === 0) return prev
        const next: Record<string, { status: string; kind: 'success' | 'error'; message?: string }> = {}
        for (const [inputId, status] of Object.entries(prev)) {
          if (!pendingInputIdSet.has(inputId)) continue
          next[inputId] = status
        }
        return next
      })

      setAskDockOpenByInputId((prevAskDockOpenByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs,
          prevAskDockOpenByInputId,
          prevAskDraftByInputId: {},
          prevAskPageIndexByInputId: {},
        }).askDockOpenByInputId
      })
      setAskDraftByInputId((prevAskDraftByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs,
          prevAskDockOpenByInputId: {},
          prevAskDraftByInputId,
          prevAskPageIndexByInputId: {},
        }).askDraftByInputId
      })
      setAskPageIndexByInputId((prevAskPageIndexByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs,
          prevAskDockOpenByInputId: {},
          prevAskDraftByInputId: {},
          prevAskPageIndexByInputId,
        }).askPageIndexByInputId
      })
    },
    [],
  )

  const nextCanonicalReplaySeq = useCallback((candidate?: unknown): number => {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      const replaySeq = candidate > canonicalReplaySeqRef.current ? candidate : canonicalReplaySeqRef.current + 1
      canonicalReplaySeqRef.current = replaySeq
      return replaySeq
    }
    canonicalReplaySeqRef.current += 1
    return canonicalReplaySeqRef.current
  }, [])

  const toCanonicalMeta = useCallback(
    (args: {
      threadId: string | null | undefined
      turnId: string
      kind: string
      params?: Record<string, unknown> | null | undefined
    }): {
      threadId: string
      replaySeq: number
      eventId: string
      ts: string
      source: CanonicalEventSource
    } => {
      const resolvedThreadId = args.threadId ?? activeThreadIdRef.current ?? '__active_thread__'
      const params = args.params
      const replaySeq = nextCanonicalReplaySeq(params?.replaySeq)
      const eventIdRaw = typeof params?.eventId === 'string' ? params.eventId.trim() : ''
      const eventId = eventIdRaw || `${resolvedThreadId}:${args.turnId}:${args.kind}:${replaySeq}`
      const ts = typeof params?.ts === 'string' && params.ts.trim() ? params.ts : runtimePorts.nowIso()
      const sourceRaw = params?.source
      const source = isCanonicalEventSource(sourceRaw) ? sourceRaw : 'engine'
      return {
        threadId: resolvedThreadId,
        replaySeq,
        eventId,
        ts,
        source,
      }
    },
    [nextCanonicalReplaySeq, runtimePorts],
  )

  const refreshThreads = useCallback(async () => {
    const result = await request('thread/list', { limit: 50 })
    dispatch({ type: 'set_threads', threads: asThreadSummaries(result) })
  }, [request])

  const refreshWorkspaceDiff = useCallback(async () => {
    setIsRefreshingDiff(true)
    try {
      const result = await request('bridge/readDiff', { maxBytes: 180 * 1024 })
      if (result && typeof result === 'object') {
        setDiffSnapshot(result as DiffSnapshot)
      }
    } finally {
      setIsRefreshingDiff(false)
    }
  }, [request])

  const setThreadHistoryLoading = useCallback((threadId: string, loading: boolean) => {
    if (loading) {
      historyLoadingRef.current = { ...historyLoadingRef.current, [threadId]: true }
    } else {
      const nextRef = { ...historyLoadingRef.current }
      delete nextRef[threadId]
      historyLoadingRef.current = nextRef
    }
    setHistoryLoadingByThreadId((prev) => {
      const current = Boolean(prev[threadId])
      if (current === loading) return prev
      if (loading) return { ...prev, [threadId]: true }
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }, [])

  const setThreadTranscriptSource = useCallback((threadId: string, source: ThreadTranscriptSource) => {
    transcriptSourceByThreadRef.current = { ...transcriptSourceByThreadRef.current, [threadId]: source }
    setTranscriptSourceByThreadId((prev) => {
      if (prev[threadId] === source) return prev
      return { ...prev, [threadId]: source }
    })
  }, [])

  const clearThreadHistoryCursor = useCallback((threadId: string) => {
    const nextHistoryLoadingRef = { ...historyLoadingRef.current }
    delete nextHistoryLoadingRef[threadId]
    historyLoadingRef.current = nextHistoryLoadingRef
    setHistoryLoadingByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
    setHistoryCursorByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }, [])

  const beginThreadHistoryRequest = useCallback(
    (threadId: string) => {
      const nextSeq = (historyLoadSeqByThreadRef.current[threadId] ?? 0) + 1
      historyLoadSeqByThreadRef.current = { ...historyLoadSeqByThreadRef.current, [threadId]: nextSeq }
      setThreadHistoryLoading(threadId, true)
      return nextSeq
    },
    [setThreadHistoryLoading],
  )

  const endThreadHistoryRequest = useCallback(
    (threadId: string, seq: number) => {
      if (historyLoadSeqByThreadRef.current[threadId] !== seq) return
      setThreadHistoryLoading(threadId, false)
    },
    [setThreadHistoryLoading],
  )

  const loadThreadHistory = useCallback(
    async (threadId: string) => {
      const token = ++historyLoadTokenRef.current
      const seq = beginThreadHistoryRequest(threadId)
      try {
        const historyResult = await request('thread/messages', { threadId, limit: 50 })
        if (token !== historyLoadTokenRef.current) return false
        if (activeThreadIdRef.current !== threadId) return false
        const parsed = asThreadMessages(historyResult)
        const logs = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs })
        setLogsByThreadId((prev) => ({ ...prev, [threadId]: logs }))
        setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
        setThreadTranscriptSource(threadId, 'history')
        return true
      } catch {
        if (token !== historyLoadTokenRef.current) return false
        if (activeThreadIdRef.current !== threadId) return false
        return false
      } finally {
        endThreadHistoryRequest(threadId, seq)
      }
    },
    [beginThreadHistoryRequest, endThreadHistoryRequest, request, setThreadTranscriptSource],
  )

  const resumeThreadInputs = useCallback(
    async (threadId: string) => {
      try {
        const resumeResult = await request('thread/resume', { threadId })
        const staleInputs = asResolvedInputs(resumeResult)
        for (const input of staleInputs) {
          if (seenStaleInputIdRef.current.has(input.inputId)) continue
          seenStaleInputIdRef.current.add(input.inputId)
          log(
            `Recovered stale input: ${input.kind} (${input.status})${input.reason ? ` - ${input.reason}` : ''}`,
            input.status === 'failed' ? 'error' : 'warn',
            input.turnId,
          )
        }
      } catch {
        // best-effort resume
      }
    },
    [log, request],
  )

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    client.notify('initialized')
  }, [])

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

  useEffect(() => {
    activeThreadIdRef.current = state.activeThreadId
  }, [state.activeThreadId])

  useEffect(() => {
    stateLogsRef.current = state.logs
  }, [state.logs])

  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
  }, [logsByThreadId])

  useEffect(() => {
    selectedInputIdRef.current = state.selectedInputId
  }, [state.selectedInputId])

  useEffect(() => {
    const pendingIdSet = toPendingInputIdSet(state.pendingInputs)
    const nextSelectedInputId = resolveSelectedInputId({
      pendingInputsById: state.pendingInputs,
      selectedInputId: state.selectedInputId,
    })
    if (nextSelectedInputId !== state.selectedInputId) {
      dispatch({ type: 'set_selected_input', inputId: nextSelectedInputId })
    }

    setAskDockOpenByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskDraftByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskPageIndexByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
  }, [state.pendingInputs, state.selectedInputId])

  useEffect(() => {
    const pendingInputs = Object.values(state.pendingInputs)
    setAskDockOpenByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs,
        prevAskDockOpenByInputId: prev,
        prevAskDraftByInputId: {},
        prevAskPageIndexByInputId: {},
      }).askDockOpenByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskDraftByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs,
        prevAskDockOpenByInputId: {},
        prevAskDraftByInputId: prev,
        prevAskPageIndexByInputId: {},
      }).askDraftByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskPageIndexByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs,
        prevAskDockOpenByInputId: {},
        prevAskDraftByInputId: {},
        prevAskPageIndexByInputId: prev,
      }).askPageIndexByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
  }, [state.pendingInputs])

  useEffect(() => {
    const threadId = state.activeThreadId
    if (!threadId) return
    setLogsByThreadId((prev) => ({ ...prev, [threadId]: state.logs }))
  }, [state.activeThreadId, state.logs])

  useEffect(() => {
    const client = new RpcClient()
    clientRef.current = client
    client.connect(bridgeUrl, {
      onStatus: (connectionStatus) => {
        dispatch({ type: 'set_connection_status', status: connectionStatus })
        if (connectionStatus === 'connected') {
          eventCursorRef.current = createTurnEventCursorState(SEEN_EVENT_CAP)
          void initializeHandshake()
            .then(async () => {
              await Promise.all([refreshThreads(), refreshWorkspaceDiff()])
              const activeThreadId = activeThreadIdRef.current
              if (activeThreadId) {
                await resumeThreadInputs(activeThreadId)
                await replayThreadEvents(activeThreadId)
              }
            })
            .catch((error) => captureError('initialize', error))
        }
      },
      onNotification: handleNotification,
      onError: (error) => {
        captureError('transport', error)
      },
    })

    return () => {
      client.disconnect()
      clientRef.current = null
    }
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

  const sortedThreads = useMemo(
    () => [...state.threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [state.threads],
  )
  const cwdOptions = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    for (const thread of sortedThreads) {
      const cwd = typeof thread.cwd === 'string' ? thread.cwd : ''
      if (!cwd || seen.has(cwd)) continue
      seen.add(cwd)
      values.push(cwd)
    }
    return values
  }, [sortedThreads])
  useEffect(() => {
    const activeThread = state.activeThreadId ? state.threads.find((thread) => thread.id === state.activeThreadId) : null
    if (activeThread?.cwd && activeThread.cwd !== selectedCwd) {
      setSelectedCwd(activeThread.cwd)
      return
    }
    if (selectedCwd && cwdOptions.includes(selectedCwd)) return
    const fallback = cwdOptions[0] ?? null
    if (fallback !== selectedCwd) {
      setSelectedCwd(fallback)
    }
  }, [cwdOptions, selectedCwd, state.activeThreadId, state.threads])

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
        historyLoadTokenRef,
        historyLoadingRef,
        transcriptSourceByThreadRef,
        beginThreadHistoryRequest,
        endThreadHistoryRequest,
        setIsThreadActionBusy,
        setLogsByThreadId,
        setHistoryCursorByThreadId,
        replayThreadEvents,
        resumeThreadInputs,
        refreshThreads,
        refreshWorkspaceDiff,
      }),
    [
      beginThreadHistoryRequest,
      endThreadHistoryRequest,
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
    submitStatus: selectedInput ? (submitStatusByInputId[selectedInput.inputId] ?? null) : null,
    isSubmittingInput,
    onAskOpen: () => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: true }))
    },
    onAskDismiss: () => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: false }))
    },
    onAskPageChange: (page) => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskPageIndexByInputId((prev) => ({ ...prev, [selectedInput.inputId]: Math.max(0, page) }))
    },
    onAskDraftChange: (fieldId, value) => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskDraftByInputId((prev) => ({
        ...prev,
        [selectedInput.inputId]: {
          ...(prev[selectedInput.inputId] ?? {}),
          [fieldId]: value,
        },
      }))
    },
    onSubmitInput: (inputId, answers) => void submitInputById(inputId, answers).catch(() => undefined),
    diffSnapshot,
    onRefreshDiff: () => void refreshWorkspaceDiff().catch(() => undefined),
    isRefreshingDiff,
  }
}
