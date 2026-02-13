import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { RpcClient } from '../rpcClient'
import { appReducer, initialAppState } from '../store'
import type { PendingInput, ResolvedInput, RpcNotification, TranscriptItem } from '../types'
import { formatToolInputAsParamsText } from '../toolEventNormalizer'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from '../turnEventCursor'
import { type DiffSnapshot } from '../components/WorktreeDiffPane'
import { mapThreadHistoryToCanonicalLogs } from '../eventAdapters'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import { isWebSupportedCommand } from './core/commandSupport'
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
  canFastRebaseGapWithoutHistory,
  shouldPromoteReplayAsCanonical,
  type ThreadTranscriptSource,
} from './core/replayMachine'
import { isNotificationForActiveThread, resolveNotificationReplaySeq } from './core/appEventMachine'
import {
  displayThreadTitle,
  summarizeToolEvent,
  toRpcError,
  toRuntimePendingInputsById,
  toSubmitUiStatus,
  toToolUseId,
  toTurnFooterStatus,
  type RpcErrorDetails,
} from './core/threadTransforms'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../../../../src/features/semantics/threadRuntimeState'
import { resolveCommandRouting } from '../../../../src/features/semantics/commandRouting'
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
      const params = (notification.params ?? {}) as any
      const threadId = extractThreadIdFromNotificationParams(params)
      if (threadId) {
        const current = runtimeStateByThreadRef.current[threadId]
        const replaySeqRaw =
          typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
        const replaySeq = resolveNotificationReplaySeq({
          replaySeqFromParams: replaySeqRaw,
          previousReplaySeq: current?.lastReplaySeq ?? 0,
        })
        const baseState =
          current ??
          createInitialThreadRuntimeState({
            threadId,
            replaySeq,
            method: notification.method,
            ts: params?.ts,
          })
        runtimeStateByThreadRef.current[threadId] = reduceThreadRuntimeState(baseState, {
          method: notification.method,
          params,
          replaySeq,
        })
      }
      const replaySeq = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
      if (threadId && replaySeq != null) {
        const current = replayCursorByThreadRef.current[threadId]
        replayCursorByThreadRef.current[threadId] = typeof current === 'number' ? Math.max(current, replaySeq) : replaySeq
      }
      if (!shouldProcessSequencedNotification(params)) return
      switch (notification.method) {
        case 'turn/started': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) break
          const turnId = String(params?.turn?.id ?? '')
          const nextMode = params?.turn?.mode
          if (isReplMode(nextMode)) {
            setMode(nextMode)
            cacheThreadMode(threadId ?? activeThreadIdRef.current, nextMode)
          }
          dispatch({ type: 'set_active_turn', turnId: turnId || null })
          break
        }

        case 'turn/modeChanged': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) break
          if (isReplMode(params?.mode)) {
            setMode(params.mode)
            cacheThreadMode(threadId ?? activeThreadIdRef.current, params.mode)
          }
          break
        }

        case 'turn/completed': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) {
            void refreshThreads().catch(() => undefined)
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            const threadId =
              typeof params?.turn?.threadId === 'string' ? params.turn.threadId : activeThreadIdRef.current
            const thinkingMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'thinking_finalized',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...thinkingMeta,
                kind: 'thinking_finalized',
                turnId,
              },
            })
            const footerMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'turn_footer',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...footerMeta,
                kind: 'turn_footer',
                turnId,
                status: 'completed',
              },
            })
          }
          dispatch({ type: 'set_active_turn', turnId: null })
          if (turnId) {
            commandByTurnRef.current.delete(turnId)
          }
          void refreshThreads().catch(() => undefined)
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/failed': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) {
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            const threadId =
              typeof params?.turn?.threadId === 'string' ? params.turn.threadId : activeThreadIdRef.current
            const thinkingMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'thinking_finalized',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...thinkingMeta,
                kind: 'thinking_finalized',
                turnId,
              },
            })
            const footerMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'turn_footer',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...footerMeta,
                kind: 'turn_footer',
                turnId,
                status: toTurnFooterStatus(String(params?.error ?? '')),
                message: String(params?.error ?? 'unknown'),
              },
            })
          }
          dispatch({ type: 'set_active_turn', turnId: null })
          const command = turnId ? commandByTurnRef.current.get(turnId) : undefined
          if (command) {
            log(`Command failed: ${command}`, 'error', turnId)
            commandByTurnRef.current.delete(turnId)
          }
          log(`Turn failed: ${String(params?.error ?? 'unknown')}`, 'error', turnId || undefined)
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/event': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) break
          const turnId = String(params?.turnId ?? '')
          const eventThreadId =
            typeof params?.threadId === 'string' ? params.threadId : activeThreadIdRef.current
          if (!turnId) break
          const eventType = params?.event?.type
          if (eventType === 'assistant_delta') {
            const textDelta = String(params?.event?.text ?? '')
            if (!textDelta) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'assistant_delta',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'assistant_delta',
                turnId,
                textDelta,
              },
            })
            break
          }

          if (eventType === 'thinking_delta') {
            const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
            if (text) {
              const meta = toCanonicalMeta({
                threadId: eventThreadId,
                turnId,
                kind: 'thinking_delta',
                params,
              })
              dispatch({
                type: 'apply_canonical_event',
                event: {
                  ...meta,
                  kind: 'thinking_delta',
                  turnId,
                  textDelta: text,
                },
              })
            }
            break
          }

          if (eventType === 'tool_start' || eventType === 'tool_update' || eventType === 'tool_end') {
            const event = params?.event
            const toolUseId = toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId)
            if (!toolUseId) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'tool_event',
              params,
            })
            const summary = summarizeToolEvent(event)
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_event',
                turnId,
                toolUseId,
                phase: eventType === 'tool_start' ? 'start' : eventType === 'tool_update' ? 'update' : 'end',
                ...(event?.name ? { toolName: String(event.name) } : {}),
                ...(eventType === 'tool_update' && summary ? { line: summary } : {}),
                ...(eventType === 'tool_end' && summary ? { summary } : {}),
                ...(event?.input ? { paramsText: formatToolInputAsParamsText(event.input) } : {}),
                isError: Boolean(event?.result?.is_error),
              },
            })
            break
          }

          if (eventType === 'error') {
            log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
            break
          }

          if (eventType === 'tool_input') {
            const event = params?.event
            const toolUseId = toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId)
            if (!toolUseId) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'tool_event',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_event',
                turnId,
                toolUseId,
                phase: 'update',
                ...(event?.name ? { toolName: String(event.name) } : {}),
                ...(event?.input ? { paramsText: formatToolInputAsParamsText(event.input) } : {}),
              },
            })
            break
          }

          break
        }

        case 'turn/inputRequested': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) break
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          const meta = toCanonicalMeta({
            threadId: input.threadId,
            turnId: input.turnId,
            kind: 'tool_input_state',
            params,
          })
          dispatch({
            type: 'apply_canonical_event',
            event: {
              ...meta,
              kind: 'tool_input_state',
              turnId: input.turnId,
              toolUseId: input.toolUseId,
              ...(typeof input.payload?.toolName === 'string' ? { toolName: input.payload.toolName } : {}),
              inputKind: input.kind,
              status: 'pending',
            },
          })
          dispatch({ type: 'input_requested', input })
          dispatch({ type: 'set_selected_input', inputId: input.inputId })
          if (input.kind === 'ask_user_question') {
            setAskDockOpenByInputId((prev) => ({ ...prev, [input.inputId]: true }))
            setAskPageIndexByInputId((prev) => ({ ...prev, [input.inputId]: prev[input.inputId] ?? 0 }))
          }
          break
        }

        case 'turn/inputResolved': {
          if (!isNotificationForActiveThread({ params, activeThreadId: activeThreadIdRef.current })) break
          const input = params?.input as ResolvedInput | undefined
          const inputId = input?.inputId as string | undefined
          if (!inputId) break
          if (input?.turnId && input?.toolUseId && input?.kind && input?.status) {
            const meta = toCanonicalMeta({
              threadId: input.threadId,
              turnId: input.turnId,
              kind: 'tool_input_state',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_input_state',
                turnId: input.turnId,
                toolUseId: input.toolUseId,
                inputKind: input.kind,
                status: input.status,
              },
            })
          }
          setAskDockOpenByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          setAskDraftByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          setAskPageIndexByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          dispatch({
            type: 'input_resolved',
            inputId,
            status: String(input?.status ?? 'unknown'),
            resolvedAt: typeof input?.resolvedAt === 'string' ? input.resolvedAt : undefined,
            reason: typeof input?.reason === 'string' ? input.reason : undefined,
          })
          if (input?.status && input.status !== 'submitted') {
            setSubmitStatusByInputId((prev) => ({
              ...prev,
              [inputId]: {
                status: input.status,
                kind: input.status === 'failed' ? 'error' : 'success',
                message: input.reason,
              },
            }))
          }
          break
        }

        default:
          break
      }
    },
    [
      cacheThreadMode,
      isNotificationForActiveThread,
      log,
      toCanonicalMeta,
      refreshThreads,
      refreshWorkspaceDiff,
      shouldProcessSequencedNotification,
    ],
  )

  const replayThreadEvents = useCallback(
    async (threadId: string, options?: { fromStart?: boolean }): Promise<boolean> => {
      const fromStart = options?.fromStart === true
      let after = fromStart ? 0 : (replayCursorByThreadRef.current[threadId] ?? 0)
      const initialAfter = after
      let latestCursor = after
      let replayState: ReplayStateSnapshot | null = null
      let receivedEntries = false
      let pageCount = 0

      while (pageCount < 100) {
        pageCount += 1
        const result = await request('thread/replay', { threadId, after, limit: 200 })
        const replay = asThreadReplay(result)
        latestCursor = replay.latestCursor
        if (replay.state) {
          replayState = replay.state
          runtimeStateByThreadRef.current[threadId] = {
            threadId,
            mode: replay.state.mode,
            activeTurnId: replay.state.activeTurnId,
            lastTurnId: replay.state.lastTurnId,
            lastTurnStatus: replay.state.lastTurnStatus,
            pendingInputs: toRuntimePendingInputsById(replay.state.pendingInputs),
            toolNameByUseId: replay.state.toolNameByUseId,
            updatedAt: replay.state.updatedAt,
            lastNotificationMethod: null,
            lastReplaySeq: replay.latestCursor,
          }
          if (activeThreadIdRef.current === threadId && Object.keys(replay.state.toolNameByUseId).length > 0) {
            dispatch({
              type: 'hydrate_projection_tool_names',
              threadId,
              toolNameByUseId: replay.state.toolNameByUseId,
            })
          }
        }

        if (replay.hasGap) {
          if (replay.state?.projection) {
            if (activeThreadIdRef.current !== threadId) return true
            dispatch({
              type: 'hydrate_projection_snapshot',
              threadId,
              snapshot: replay.state.projection,
            })
            setThreadTranscriptSource(threadId, 'replay')
            clearThreadHistoryCursor(threadId)
            replayCursorByThreadRef.current[threadId] = replay.latestCursor
            if (activeThreadIdRef.current === threadId) {
              syncPendingInputsFromReplayState(threadId, replay.state)
              dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
              const nextMode = replay.state.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
              setMode(nextMode)
              cacheThreadMode(threadId, nextMode)
            }
            return true
          }

          const baselineResult = await request('thread/replay', { threadId })
          const baselineReplay = asThreadReplay(baselineResult)
          if (baselineReplay.state) {
            runtimeStateByThreadRef.current[threadId] = {
              threadId,
              mode: baselineReplay.state.mode,
              activeTurnId: baselineReplay.state.activeTurnId,
              lastTurnId: baselineReplay.state.lastTurnId,
              lastTurnStatus: baselineReplay.state.lastTurnStatus,
              pendingInputs: toRuntimePendingInputsById(baselineReplay.state.pendingInputs),
              toolNameByUseId: baselineReplay.state.toolNameByUseId,
              updatedAt: baselineReplay.state.updatedAt,
              lastNotificationMethod: null,
              lastReplaySeq: baselineReplay.latestCursor,
            }
            replayState = baselineReplay.state
            if (activeThreadIdRef.current === threadId && Object.keys(baselineReplay.state.toolNameByUseId).length > 0) {
              dispatch({
                type: 'hydrate_projection_tool_names',
                threadId,
                toolNameByUseId: baselineReplay.state.toolNameByUseId,
              })
            }
          }
          if (baselineReplay.state?.projection) {
            if (activeThreadIdRef.current !== threadId) return true
            dispatch({
              type: 'hydrate_projection_snapshot',
              threadId,
              snapshot: baselineReplay.state.projection,
            })
            setThreadTranscriptSource(threadId, 'replay')
            clearThreadHistoryCursor(threadId)
            replayCursorByThreadRef.current[threadId] = baselineReplay.latestCursor
            syncPendingInputsFromReplayState(threadId, baselineReplay.state)
            dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
            const nextMode = baselineReplay.state.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
            setMode(nextMode)
            cacheThreadMode(threadId, nextMode)
            return true
          }
          const threadTranscriptSource = transcriptSourceByThreadRef.current[threadId]
          const cachedThreadLogs =
            activeThreadIdRef.current === threadId
              ? stateLogsRef.current
              : (logsByThreadIdRef.current[threadId] ?? [])
          if (
            canFastRebaseGapWithoutHistory({
              transcriptSource: threadTranscriptSource,
              cachedLogsLength: cachedThreadLogs.length,
            })
          ) {
            replayCursorByThreadRef.current[threadId] = replay.latestCursor
            if (activeThreadIdRef.current === threadId) {
              if (replay.state) {
                syncPendingInputsFromReplayState(threadId, replay.state)
              }
              dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
              const nextMode = replay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
              setMode(nextMode)
              if (replay.state) {
                cacheThreadMode(threadId, nextMode)
              }
            }
            return true
          }
          if (activeThreadIdRef.current === threadId) {
            dispatch({ type: 'replace_logs', logs: [] })
          } else {
            setLogsByThreadId((prev) => ({
              ...prev,
              [threadId]: [],
            }))
          }
          setThreadTranscriptSource(threadId, 'replay')
          clearThreadHistoryCursor(threadId)
          replayCursorByThreadRef.current[threadId] =
            baselineReplay.nextCursor > 0 ? baselineReplay.nextCursor : baselineReplay.latestCursor
          if (activeThreadIdRef.current === threadId) {
            syncPendingInputsFromReplayState(threadId, baselineReplay.state ?? null)
            dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
            const nextMode = baselineReplay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
            setMode(nextMode)
            if (baselineReplay.state) {
              cacheThreadMode(threadId, nextMode)
            }
          }
          return true
        }

        if (fromStart && replay.latestCursor === 0 && replay.data.length === 0) {
          const loaded = await loadThreadHistory(threadId)
          if (!loaded) return false
          replayCursorByThreadRef.current[threadId] = 0
          if (activeThreadIdRef.current === threadId) {
            syncPendingInputsFromReplayState(threadId, replay.state ?? null)
            dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
            const nextMode = replay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
            setMode(nextMode)
            if (replay.state) {
              cacheThreadMode(threadId, nextMode)
            }
          }
          return true
        }

        for (const entry of replay.data) {
          receivedEntries = true
          handleNotification({
            jsonrpc: '2.0',
            method: entry.method,
            ...(entry.params === undefined ? {} : { params: entry.params }),
          })
        }

        const nextAfter = replay.nextCursor > 0 ? replay.nextCursor : replay.latestCursor
        if (nextAfter <= after || nextAfter >= replay.latestCursor) {
          after = nextAfter
          break
        }
        after = nextAfter
      }

      if (fromStart && !receivedEntries) {
        const loaded = await loadThreadHistory(threadId)
        if (!loaded) return false
      }

      const currentTranscriptSource = transcriptSourceByThreadRef.current[threadId]
      if (
        shouldPromoteReplayAsCanonical({
          receivedEntries,
          fromStart,
          initialAfter,
          currentTranscriptSource,
        })
      ) {
        setThreadTranscriptSource(threadId, 'replay')
        clearThreadHistoryCursor(threadId)
      }

      replayCursorByThreadRef.current[threadId] = after > 0 ? after : latestCursor
      if (activeThreadIdRef.current === threadId) {
        syncPendingInputsFromReplayState(threadId, replayState)
        dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
        const nextMode = replayState?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
        setMode(nextMode)
        if (replayState) {
          cacheThreadMode(threadId, nextMode)
        }
      }
      return true
    },
    [
      cacheThreadMode,
      clearThreadHistoryCursor,
      handleNotification,
      loadThreadHistory,
      request,
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

  const startThread = async () => {
      const previousThreadId = state.activeThreadId
      const previousLogs = state.logs
      setIsThreadActionBusy(true)
      try {
      const result = await request('thread/start', selectedCwd ? { cwd: selectedCwd } : {})
      const thread = result?.thread as { id?: string; cwd?: string } | undefined
      if (thread?.id) {
        if (thread.cwd) {
          setSelectedCwd(thread.cwd)
        }
        setMode(runtimeStateByThreadRef.current[thread.id]?.mode ?? 'normal')
        activeThreadIdRef.current = thread.id
        dispatch({ type: 'set_active_thread', threadId: thread.id })
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs: logsByThreadId[thread.id] ?? [] })
        const replayLoaded = await replayThreadEvents(thread.id, { fromStart: true })
        if (!replayLoaded) {
          activeThreadIdRef.current = previousThreadId
          dispatch({ type: 'set_active_thread', threadId: previousThreadId })
          dispatch({
            type: 'replace_logs',
            logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
          })
          log('Failed to hydrate new thread transcript. Restored previous thread.', 'warn')
          return
        }
        await resumeThreadInputs(thread.id)
        await refreshThreads()
        await refreshWorkspaceDiff()
        log(`Thread created: ${thread.id}`)
      }
    } finally {
      setIsThreadActionBusy(false)
    }
  }

  const startTurn = async () => {
    const text = inputText.trim()
    if (!text || isSendingTurn) return

    const commandRouting = resolveCommandRouting(text)
    if (
      commandRouting.isSlashCommandAfterTrim &&
      commandRouting.commandName &&
      !isWebSupportedCommand(commandRouting.commandName)
    ) {
      setInputText('')
      dispatch({
        type: 'push_message',
        role: 'assistant',
        text: `Web reference does not support ${commandRouting.commandName} yet. Please use TUI for this command.`,
      })
      return
    }

    if (commandRouting.isExactClear) {
      setInputText('')
      if (commandRouting.commandArgs) {
        dispatch({ type: 'push_message', role: 'assistant', text: 'Usage: /clear' })
        return
      }
      await startThread()
      return
    }
    if (!state.activeThreadId) {
      log('Please select or create a thread first', 'warn')
      return
    }

    const shouldDispatchCommand = commandRouting.shouldUseCommandDispatch
    const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId)
    const requestCwd = selectedCwd ?? activeThread?.cwd
    dispatch({ type: 'push_message', role: 'user', text })
    setInputText('')
    if (shouldDispatchCommand) {
      log(`Command queued: ${text}`, 'info')
    }

    setIsSendingTurn(true)
    try {
      const result = shouldDispatchCommand
        ? await request('command/dispatch', {
            threadId: state.activeThreadId,
            command: text,
            mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
        : await request('turn/start', {
            threadId: state.activeThreadId,
            input: { text },
            mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
      const localStdout =
        typeof (result as { local?: { stdout?: unknown } } | null)?.local?.stdout === 'string'
          ? ((result as { local?: { stdout?: string } }).local?.stdout ?? '')
          : ''
      if (localStdout) {
        dispatch({ type: 'push_message', role: 'assistant', text: localStdout })
        return
      }
      const turnId = String((result as any)?.turn?.id ?? '')
      if (turnId) {
        dispatch({ type: 'set_active_turn', turnId })
        dispatch({ type: 'bind_last_user_message_turn', turnId })
        if (shouldDispatchCommand) {
          commandByTurnRef.current.set(turnId, text)
        }
      }
    } finally {
      setIsSendingTurn(false)
    }
  }

  const interruptTurn = async () => {
    if (!state.activeThreadId || !state.activeTurnId || isInterruptingTurn) return
    setIsInterruptingTurn(true)
    try {
      await request('turn/interrupt', {
        threadId: state.activeThreadId,
        turnId: state.activeTurnId,
      })
      log(`Interrupt requested: ${state.activeTurnId}`, 'warn', state.activeTurnId)
    } finally {
      setIsInterruptingTurn(false)
    }
  }

  const submitInputById = async (inputId: string, answers: Record<string, string>) => {
    const input = state.pendingInputs[inputId]
    if (!input || isSubmittingInput) return

    setIsSubmittingInput(true)
    try {
      const response = await request('turn/input/submit', {
        threadId: input.threadId,
        turnId: input.turnId,
        inputId: input.inputId,
        toolUseId: input.toolUseId,
        answers,
        submissionId: `web-${runtimePorts.nowMs()}`,
      })
      const status = String((response as { status?: string })?.status ?? 'unknown')
      const uiStatus = toSubmitUiStatus(status)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status,
          kind: uiStatus.kind,
          message: uiStatus.message,
        },
      }))
      log(`Input submit: ${status}`, uiStatus.kind === 'error' ? 'error' : 'info', input.turnId)
    } catch (error) {
      const details = toRpcError('turn/input/submit', error)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status: details.code != null ? `rpc_${details.code}` : 'error',
          kind: 'error',
          message: details.message,
        },
      }))
      throw error
    } finally {
      setIsSubmittingInput(false)
    }
  }

  const onSend = (event: FormEvent) => {
    event.preventDefault()
    void startTurn().catch(() => undefined)
  }

  const selectThread = useCallback(
    (threadId: string) => {
      if (threadId === state.activeThreadId) return
      const nextThread = state.threads.find((thread) => thread.id === threadId)
      if (nextThread?.cwd) {
        setSelectedCwd(nextThread.cwd)
      }
      const previousThreadId = state.activeThreadId
      const previousLogs = state.logs
      const cachedLogs = logsByThreadId[threadId] ?? []
      setMode(runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal')
      activeThreadIdRef.current = threadId
      dispatch({ type: 'set_active_thread', threadId })
      dispatch({ type: 'set_active_turn', turnId: null })
      dispatch({ type: 'clear_pending_inputs' })
      dispatch({ type: 'replace_logs', logs: cachedLogs })
      void (async () => {
        const hasReplayCursor = typeof replayCursorByThreadRef.current[threadId] === 'number'
        const replayLoaded = await replayThreadEvents(threadId, { fromStart: !hasReplayCursor }).catch(() => false)
        if (!replayLoaded) {
          if (activeThreadIdRef.current === threadId) {
            activeThreadIdRef.current = previousThreadId
            dispatch({ type: 'set_active_thread', threadId: previousThreadId })
            dispatch({
              type: 'replace_logs',
              logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
            })
            log('Failed to hydrate selected thread transcript. Restored previous thread.', 'warn')
          }
          return
        }
        if (activeThreadIdRef.current !== threadId) return
        await resumeThreadInputs(threadId)
      })().catch(() => undefined)
    },
    [
      log,
      logsByThreadId,
      replayThreadEvents,
      resumeThreadInputs,
      state.activeThreadId,
      state.logs,
      state.threads,
    ],
  )

  const selectCwd = useCallback(
    (cwd: string) => {
      if (!cwd || cwd === selectedCwd) return
      setSelectedCwd(cwd)
      const targetThread = sortedThreads.find((thread) => thread.cwd === cwd)
      if (!targetThread) {
        activeThreadIdRef.current = null
        setMode('normal')
        dispatch({ type: 'set_active_thread', threadId: null })
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs: [] })
        return
      }
      if (targetThread.id !== state.activeThreadId) {
        selectThread(targetThread.id)
      }
    },
    [selectThread, selectedCwd, sortedThreads, state.activeThreadId],
  )

  const renameThread = useCallback(
    async (threadId: string, label: string) => {
      const nextLabel = label.trim()
      if (!threadId || !nextLabel) return
      setIsThreadActionBusy(true)
      try {
        await request('thread/rename', { threadId, label: nextLabel })
        await refreshThreads()
      } finally {
        setIsThreadActionBusy(false)
      }
    },
    [refreshThreads, request],
  )

  const loadEarlierHistory = useCallback(async () => {
    const threadId = state.activeThreadId
    if (!threadId || historyLoadingRef.current[threadId]) return
    if (transcriptSourceByThreadRef.current[threadId] !== 'history') return
    const cursor = historyCursorByThreadId[threadId]
    if (!cursor) return

    const token = historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const result = await request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== historyLoadTokenRef.current) return
      if (activeThreadIdRef.current !== threadId) return
      const parsed = asThreadMessages(result)
      const prepended = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      dispatch({ type: 'prepend_logs', logs: prepended })
      setLogsByThreadId((prev) => {
        const current = prev[threadId] ?? state.logs
        return { ...prev, [threadId]: [...prepended, ...current] }
      })
      setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }, [
    beginThreadHistoryRequest,
    endThreadHistoryRequest,
    historyCursorByThreadId,
    request,
    state.activeThreadId,
    state.logs,
  ])

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
