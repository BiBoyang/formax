import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LeftRail } from './components/LeftRail'
import { PendingInputPane } from './components/PendingInputPane'
import { TranscriptPane } from './components/TranscriptPane'
import { RpcClient, RpcRequestError } from './rpcClient'
import { PanelLeft } from 'lucide-react'
import { appReducer, initialAppState } from './store'
import type { PendingInput, ResolvedInput, RpcNotification, ThreadMessage, ThreadSummary, TranscriptItem } from './types'
import { cn } from './lib/utils'
import { Button } from './components/ui/button'

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3777'
const RIGHT_RAIL_MIN_WIDTH = 280
const RIGHT_RAIL_MAX_WIDTH = 680
const CENTER_MIN_WIDTH = 560
const SIDEBAR_WIDTH = 260
const DIVIDER_WIDTH = 1
const SEEN_EVENT_CAP = 2000
const DELTA_FLUSH_MS = 50

function clampRightRailWidth(desiredWidth: number, viewportWidth: number, isSidebarOpen: boolean): number {
  const leftReserved = isSidebarOpen ? SIDEBAR_WIDTH : 0
  const available = viewportWidth - leftReserved - DIVIDER_WIDTH - CENTER_MIN_WIDTH
  if (!Number.isFinite(available) || available <= 0) return 0
  const maxByViewport = Math.min(RIGHT_RAIL_MAX_WIDTH, available)
  const minByViewport = Math.min(RIGHT_RAIL_MIN_WIDTH, maxByViewport)
  return Math.max(minByViewport, Math.min(maxByViewport, desiredWidth))
}

type RpcErrorDetails = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}
type ReplMode = 'normal' | 'acceptEdits' | 'plan'
type DeltaBucket = {
  threadId: string | null
  assistant: string
  thinking: string
}
type SubmitUiStatus = {
  kind: 'success' | 'error'
  message: string
}

type DiffSnapshot = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: Array<{
    path: string
    additions: number
    deletions: number
    patch: string
    untracked?: boolean
  }>
}

function asThreadSummaries(value: unknown): ThreadSummary[] {
  if (!value || typeof value !== 'object') return []
  const data = (value as { data?: unknown }).data
  return Array.isArray(data) ? (data as ThreadSummary[]) : []
}

function displayThreadTitle(thread: ThreadSummary | undefined): string {
  if (!thread) return 'New Thread'
  const label = thread.label?.trim()
  if (label) return label
  const prompt = thread.lastUserPrompt?.trim()
  if (prompt) return prompt
  return 'New Thread'
}

function asThreadMessages(value: unknown): { data: ThreadMessage[]; nextCursor: string | null } {
  if (!value || typeof value !== 'object') return { data: [], nextCursor: null }
  const raw = Array.isArray((value as { data?: unknown }).data) ? ((value as { data: unknown[] }).data ?? []) : []
  const data: ThreadMessage[] = raw
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const kind = record.kind
      if (kind === 'tool') {
        if (typeof record.toolName !== 'string') return null
        const status =
          record.status === 'error'
            ? 'error'
            : record.status === 'running'
              ? 'running'
              : 'completed'
        const summary = typeof record.summary === 'string' ? record.summary : `${record.toolName} completed`
        return {
          id: typeof record.id === 'string' ? record.id : `tool-${index}`,
          kind: 'tool' as const,
          toolName: record.toolName,
          status,
          summary,
          ...(typeof record.toolUseId === 'string' ? { toolUseId: record.toolUseId } : {}),
          ...(typeof record.paramsText === 'string' ? { paramsText: record.paramsText } : {}),
          ...(Array.isArray(record.detailLines)
            ? { detailLines: record.detailLines.filter((line): line is string => typeof line === 'string') }
            : {}),
        }
      }

      const role = record.role
      if (role !== 'user' && role !== 'assistant') return null
      if (typeof record.text !== 'string') return null
      return {
        id: typeof record.id === 'string' ? record.id : `msg-${index}`,
        kind: 'message' as const,
        role,
        text: record.text,
      }
    })
    .filter((entry): entry is ThreadMessage => Boolean(entry))
  const nextCursorRaw = (value as { nextCursor?: unknown }).nextCursor
  const nextCursor = typeof nextCursorRaw === 'string' ? nextCursorRaw : null
  return { data, nextCursor }
}

function asResolvedInputs(value: unknown): ResolvedInput[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as { staleInputs?: unknown }).staleInputs
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const inputId = typeof record.inputId === 'string' ? record.inputId : null
      const threadId = typeof record.threadId === 'string' ? record.threadId : null
      const turnId = typeof record.turnId === 'string' ? record.turnId : null
      const toolUseId = typeof record.toolUseId === 'string' ? record.toolUseId : null
      const kind = record.kind === 'approval' || record.kind === 'ask_user_question' ? record.kind : null
      const status =
        record.status === 'submitted' ||
        record.status === 'canceled' ||
        record.status === 'expired' ||
        record.status === 'failed'
          ? record.status
          : null
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null
      const resolvedAt = typeof record.resolvedAt === 'string' ? record.resolvedAt : null
      if (!inputId || !threadId || !turnId || !toolUseId || !kind || !status || !createdAt || !expiresAt || !resolvedAt) {
        return null
      }
      const reason = typeof record.reason === 'string' ? record.reason : undefined
      return {
        inputId,
        threadId,
        turnId,
        toolUseId,
        kind,
        status,
        createdAt,
        expiresAt,
        resolvedAt,
        ...(reason ? { reason } : {}),
      } satisfies ResolvedInput
    })
    .filter((entry): entry is ResolvedInput => Boolean(entry))
}

function mapThreadHistoryToLogs(threadId: string, messages: ThreadMessage[]): TranscriptItem[] {
  return messages.map((message) =>
    message.kind === 'tool'
      ? {
          id: `history-${threadId}-${message.id}`,
          kind: 'tool_call' as const,
          toolUseId: message.toolUseId,
          toolName: message.toolName,
          paramsText: message.paramsText,
          status: message.status,
          summary: message.summary,
          detailLines: Array.isArray(message.detailLines) ? message.detailLines : [],
        }
      : {
          id: `history-${threadId}-${message.id}`,
          kind: 'message' as const,
          role: message.role,
          text: message.text,
        },
  )
}

function summarizeToolEvent(event: any): string {
  if (!event || typeof event !== 'object') return 'tool event'
  if (event.type === 'tool_start') return ''
  if (event.type === 'tool_input') return ''
  if (event.type === 'tool_end') {
    const content = typeof event?.result?.content === 'string' ? event.result.content.trim() : ''
    return content || 'completed'
  }
  if (event.type === 'tool_update') {
    const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
    const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
    const line = transcriptLines[transcriptLines.length - 1] ?? middleLines[middleLines.length - 1]
    if (line && String(line).trim()) return String(line)
    if (typeof event.toolUses === 'number') return `tool uses ${event.toolUses}`
    return ''
  }
  return String(event.type ?? 'tool event')
}

function toToolUseId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toRpcError(method: string, error: unknown): RpcErrorDetails {
  const at = new Date().toISOString()
  if (error instanceof RpcRequestError) {
    return {
      at,
      method,
      message: error.message,
      code: error.code,
      data: error.data,
    }
  }
  if (error instanceof Error) {
    return {
      at,
      method,
      message: error.message,
    }
  }
  return {
    at,
    method,
    message: String(error),
  }
}

function toSubmitUiStatus(status: string): SubmitUiStatus {
  switch (status) {
    case 'accepted':
      return { kind: 'success', message: 'Accepted' }
    case 'already_submitted_same':
      return { kind: 'success', message: 'Same answer already accepted' }
    case 'conflict_already_submitted':
      return { kind: 'error', message: 'Different answer conflicts with previous submission' }
    case 'not_pending':
      return { kind: 'error', message: 'Input is no longer pending; refresh or re-run the action' }
    case 'expired':
      return { kind: 'error', message: 'Input expired; trigger the action again' }
    case 'canceled':
      return { kind: 'error', message: 'Input was canceled; trigger the action again' }
    default:
      return { kind: 'error', message: status }
  }
}

function toTurnFooterStatus(errorMessage: string | null | undefined): 'failed' | 'interrupted' {
  const normalized = String(errorMessage ?? '').toLowerCase()
  if (normalized.includes('interrupt') || normalized.includes('aborted') || normalized.includes('cancel')) {
    return 'interrupted'
  }
  return 'failed'
}

export function App() {
  const [bridgeUrl] = useState(DEFAULT_BRIDGE_URL)
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [mode, setMode] = useState<ReplMode>('normal')
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    clampRightRailWidth(400, typeof window === 'undefined' ? 1600 : window.innerWidth, true),
  )
  const [logsByThreadId, setLogsByThreadId] = useState<Record<string, TranscriptItem[]>>({})
  const [historyCursorByThreadId, setHistoryCursorByThreadId] = useState<Record<string, string | null>>({})
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})
  const [staleInputsByThreadId, setStaleInputsByThreadId] = useState<Record<string, ResolvedInput[]>>({})
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const lastSeqByTraceRef = useRef<Map<string, number>>(new Map())
  const seenEventIdsRef = useRef<Set<string>>(new Set())
  const seenEventOrderRef = useRef<string[]>([])
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const activeThreadIdRef = useRef<string | null>(state.activeThreadId)
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const bufferedDeltaByTurnRef = useRef<Record<string, DeltaBucket>>({})
  const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs
  const activeStaleInputs = state.activeThreadId ? (staleInputsByThreadId[state.activeThreadId] ?? []) : []

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])

  const isNotificationForActiveThread = useCallback((params: any): boolean => {
    const threadId =
      (typeof params?.threadId === 'string' ? params.threadId : null) ??
      (typeof params?.turn?.threadId === 'string' ? params.turn.threadId : null)
    if (!threadId) return true
    const activeThreadId = activeThreadIdRef.current
    if (!activeThreadId) return true
    return threadId === activeThreadId
  }, [])

  const markEventSeen = useCallback((eventId: string): boolean => {
    if (seenEventIdsRef.current.has(eventId)) return false
    seenEventIdsRef.current.add(eventId)
    seenEventOrderRef.current.push(eventId)
    if (seenEventOrderRef.current.length > SEEN_EVENT_CAP) {
      const overflow = seenEventOrderRef.current.length - SEEN_EVENT_CAP
      const dropped = seenEventOrderRef.current.splice(0, overflow)
      for (const id of dropped) {
        seenEventIdsRef.current.delete(id)
      }
    }
    return true
  }, [])

  const shouldProcessSequencedNotification = useCallback(
    (params: any): boolean => {
      const eventId = typeof params?.eventId === 'string' ? params.eventId : null
      if (eventId && !markEventSeen(eventId)) return false

      const traceId = typeof params?.traceId === 'string' ? params.traceId : null
      const seq = typeof params?.seq === 'number' && Number.isFinite(params.seq) ? params.seq : null
      if (!traceId || seq == null) return true

      const lastSeq = lastSeqByTraceRef.current.get(traceId)
      if (typeof lastSeq === 'number' && seq <= lastSeq) return false
      lastSeqByTraceRef.current.set(traceId, seq)
      return true
    },
    [markEventSeen],
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

  const flushBufferedDeltas = useCallback((targetTurnId?: string, threadId?: string | null) => {
    const entries = bufferedDeltaByTurnRef.current
    const turnIds = targetTurnId ? [targetTurnId] : Object.keys(entries)
    const activeThreadId = threadId ?? activeThreadIdRef.current
    for (const turnId of turnIds) {
      const bucket = entries[turnId]
      if (!bucket) continue
      if (activeThreadId && bucket.threadId && bucket.threadId !== activeThreadId) {
        delete entries[turnId]
        continue
      }
      if (bucket.assistant) {
        dispatch({
          type: 'append_assistant_delta',
          turnId,
          text: bucket.assistant,
        })
      }
      if (bucket.thinking) {
        dispatch({
          type: 'append_thinking_delta',
          turnId,
          text: bucket.thinking,
        })
      }
      delete entries[turnId]
    }
  }, [])

  const scheduleDeltaFlush = useCallback(() => {
    if (deltaFlushTimerRef.current) return
    deltaFlushTimerRef.current = setTimeout(() => {
      deltaFlushTimerRef.current = null
      flushBufferedDeltas()
    }, DELTA_FLUSH_MS)
  }, [flushBufferedDeltas])

  const queueDelta = useCallback(
    (kind: 'assistant' | 'thinking', turnId: string, text: string, threadId: string | null) => {
      if (!turnId || !text) return
      const current = bufferedDeltaByTurnRef.current[turnId] ?? { threadId, assistant: '', thinking: '' }
      if (!current.threadId && threadId) {
        current.threadId = threadId
      }
      current[kind] += text
      bufferedDeltaByTurnRef.current[turnId] = current
      scheduleDeltaFlush()
    },
    [scheduleDeltaFlush],
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
        const logs = mapThreadHistoryToLogs(threadId, parsed.data)
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs })
        setLogsByThreadId((prev) => ({ ...prev, [threadId]: logs }))
        setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
        return true
      } catch {
        if (token !== historyLoadTokenRef.current) return false
        if (activeThreadIdRef.current !== threadId) return false
        return false
      } finally {
        endThreadHistoryRequest(threadId, seq)
      }
    },
    [beginThreadHistoryRequest, endThreadHistoryRequest, request],
  )

  const resumeThreadInputs = useCallback(
    async (threadId: string) => {
      try {
        const resumeResult = await request('thread/resume', { threadId })
        const staleInputs = asResolvedInputs(resumeResult)
        setStaleInputsByThreadId((prev) => ({ ...prev, [threadId]: staleInputs }))
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
        // best-effort resume; thread history loading remains the source of truth for messages
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
      if (!shouldProcessSequencedNotification(params)) return
      switch (notification.method) {
        case 'turn/started': {
          if (!isNotificationForActiveThread(params)) break
          const turnId = String(params?.turn?.id ?? '')
          dispatch({ type: 'set_active_turn', turnId: turnId || null })
          break
        }

        case 'turn/completed': {
          if (!isNotificationForActiveThread(params)) {
            void refreshThreads().catch(() => undefined)
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            flushBufferedDeltas(turnId)
          } else {
            flushBufferedDeltas()
          }
          if (turnId) {
            dispatch({ type: 'finalize_turn_thinking', turnId })
            dispatch({ type: 'push_turn_footer', turnId, status: 'completed' })
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
          if (!isNotificationForActiveThread(params)) {
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            flushBufferedDeltas(turnId)
          } else {
            flushBufferedDeltas()
          }
          if (turnId) {
            dispatch({ type: 'finalize_turn_thinking', turnId })
            dispatch({
              type: 'push_turn_footer',
              turnId,
              status: toTurnFooterStatus(String(params?.error ?? '')),
              message: String(params?.error ?? 'unknown'),
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
          if (!isNotificationForActiveThread(params)) break
          const turnId = String(params?.turnId ?? '')
          const eventThreadId =
            typeof params?.threadId === 'string' ? params.threadId : activeThreadIdRef.current
          const eventType = params?.event?.type
          if (eventType === 'assistant_delta') {
            queueDelta('assistant', turnId, String(params?.event?.text ?? ''), eventThreadId)
            break
          }

          if (eventType === 'thinking_delta') {
            const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
            if (text) {
              queueDelta('thinking', turnId, text, eventThreadId)
            }
            break
          }

          if (eventType === 'tool_start' || eventType === 'tool_update' || eventType === 'tool_end') {
            const event = params?.event
            dispatch({
              type: 'append_tool_event',
              turnId,
              toolUseId: toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId),
              toolName: event?.name ? String(event.name) : undefined,
              phase: eventType === 'tool_start' ? 'start' : eventType === 'tool_update' ? 'update' : 'end',
              text: summarizeToolEvent(event),
              input: event?.input,
              isError: Boolean(event?.result?.is_error),
            })
            break
          }

          if (eventType === 'error') {
            log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
            break
          }

          if (eventType === 'tool_input') {
            const event = params?.event
            dispatch({
              type: 'append_tool_event',
              turnId,
              toolUseId: toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId),
              toolName: event?.name ? String(event.name) : undefined,
              phase: 'update',
              text: '',
              input: event?.input,
            })
            break
          }

          break
        }

        case 'turn/inputRequested': {
          if (!isNotificationForActiveThread(params)) break
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          dispatch({ type: 'input_requested', input })
          break
        }

        case 'turn/inputResolved': {
          if (!isNotificationForActiveThread(params)) break
          const input = params?.input as ResolvedInput | undefined
          const inputId = input?.inputId as string | undefined
          if (!inputId) break
          dispatch({ type: 'input_resolved', inputId, status: String(input?.status ?? 'unknown') })
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
      isNotificationForActiveThread,
      log,
      flushBufferedDeltas,
      queueDelta,
      refreshThreads,
      refreshWorkspaceDiff,
      shouldProcessSequencedNotification,
    ],
  )

  useEffect(() => {
    return () => {
      if (deltaFlushTimerRef.current) {
        clearTimeout(deltaFlushTimerRef.current)
        deltaFlushTimerRef.current = null
      }
      flushBufferedDeltas()
    }
  }, [flushBufferedDeltas])

  useEffect(() => {
    activeThreadIdRef.current = state.activeThreadId
  }, [state.activeThreadId])

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
          lastSeqByTraceRef.current.clear()
          seenEventIdsRef.current.clear()
          seenEventOrderRef.current = []
          void initializeHandshake()
            .then(async () => {
              await Promise.all([refreshThreads(), refreshWorkspaceDiff()])
              const activeThreadId = activeThreadIdRef.current
              if (activeThreadId) {
                await resumeThreadInputs(activeThreadId)
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
  }, [bridgeUrl, captureError, handleNotification, initializeHandshake, refreshThreads, refreshWorkspaceDiff, resumeThreadInputs])

  const sortedThreads = useMemo(
    () => [...state.threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [state.threads],
  )
  const startThread = async () => {
    const previousThreadId = state.activeThreadId
    const previousLogs = state.logs
    setIsThreadActionBusy(true)
    try {
      const result = await request('thread/start', {})
      const thread = result?.thread as { id?: string } | undefined
      if (thread?.id) {
        flushBufferedDeltas(undefined, previousThreadId)
        activeThreadIdRef.current = thread.id
        dispatch({ type: 'set_active_thread', threadId: thread.id })
        dispatch({ type: 'replace_logs', logs: logsByThreadId[thread.id] ?? [] })
        const loaded = await loadThreadHistory(thread.id)
        if (!loaded) {
          activeThreadIdRef.current = previousThreadId
          dispatch({ type: 'set_active_thread', threadId: previousThreadId })
          dispatch({
            type: 'replace_logs',
            logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
          })
          log('Failed to load new thread history. Restored previous thread.', 'warn')
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
    if (!state.activeThreadId) {
      log('Please select or create a thread first', 'warn')
      return
    }

    const text = inputText.trim()
    if (!text || isSendingTurn) return

    const isCommand = text.startsWith('/')
    dispatch({ type: 'push_message', role: 'user', text })
    setInputText('')
    if (isCommand) {
      log(`Command queued: ${text}`, 'info')
    }

    setIsSendingTurn(true)
    try {
      const result = await request('turn/start', {
        threadId: state.activeThreadId,
        input: { text },
        mode,
      })
      const turnId = String((result as any)?.turn?.id ?? '')
      if (turnId) {
        dispatch({ type: 'set_active_turn', turnId })
        dispatch({ type: 'bind_last_user_message_turn', turnId })
        if (isCommand) {
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

  const submitSelectedInput = async (answers: Record<string, string>) => {
    if (!selectedInput || isSubmittingInput) return

    setIsSubmittingInput(true)
    try {
      const response = await request('turn/input/submit', {
        threadId: selectedInput.threadId,
        turnId: selectedInput.turnId,
        inputId: selectedInput.inputId,
        toolUseId: selectedInput.toolUseId,
        answers,
        submissionId: `web-${Date.now()}`,
      })
      const status = String((response as { status?: string })?.status ?? 'unknown')
      const uiStatus = toSubmitUiStatus(status)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [selectedInput.inputId]: {
          status,
          kind: uiStatus.kind,
          message: uiStatus.message,
        },
      }))
      log(`Input submit: ${status}`, uiStatus.kind === 'error' ? 'error' : 'info', selectedInput.turnId)
    } catch (error) {
      const details = toRpcError('turn/input/submit', error)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [selectedInput.inputId]: {
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
      const previousThreadId = state.activeThreadId
      const previousLogs = state.logs
      const cachedLogs = logsByThreadId[threadId] ?? []
      flushBufferedDeltas(undefined, previousThreadId)
      activeThreadIdRef.current = threadId
      dispatch({ type: 'set_active_thread', threadId })
      dispatch({ type: 'set_active_turn', turnId: null })
      dispatch({ type: 'clear_pending_inputs' })
      dispatch({ type: 'replace_logs', logs: cachedLogs })
      void loadThreadHistory(threadId)
        .then((loaded) => {
          if (loaded) return
          if (activeThreadIdRef.current === threadId) {
            activeThreadIdRef.current = previousThreadId
            dispatch({ type: 'set_active_thread', threadId: previousThreadId })
            dispatch({
              type: 'replace_logs',
              logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
            })
            log('Failed to load selected thread history. Restored previous thread.', 'warn')
          }
        })
        .catch(() => undefined)
      void resumeThreadInputs(threadId)
    },
    [flushBufferedDeltas, loadThreadHistory, log, logsByThreadId, resumeThreadInputs, state.activeThreadId, state.logs],
  )

  const loadEarlierHistory = useCallback(async () => {
    const threadId = state.activeThreadId
    if (!threadId || historyLoadingRef.current[threadId]) return
    const cursor = historyCursorByThreadId[threadId]
    if (!cursor) return

    const token = historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const result = await request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== historyLoadTokenRef.current) return
      if (activeThreadIdRef.current !== threadId) return
      const parsed = asThreadMessages(result)
      const prepended = mapThreadHistoryToLogs(threadId, parsed.data)
      dispatch({ type: 'prepend_logs', logs: prepended })
      setLogsByThreadId((prev) => {
        const current = prev[threadId] ?? state.logs
        return { ...prev, [threadId]: [...prepended, ...current] }
      })
      setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }, [beginThreadHistoryRequest, endThreadHistoryRequest, historyCursorByThreadId, request, state.activeThreadId, state.logs])

  const activeThread = useMemo(
    () => state.threads.find((t) => t.id === state.activeThreadId),
    [state.threads, state.activeThreadId],
  )
  const activeThreadTitle = displayThreadTitle(activeThread)

  useEffect(() => {
    const syncRightRailWidth = () => {
      setRightRailWidth((previous) =>
        clampRightRailWidth(previous, window.innerWidth, isSidebarOpen),
      )
    }
    syncRightRailWidth()
    window.addEventListener('resize', syncRightRailWidth)
    return () => {
      window.removeEventListener('resize', syncRightRailWidth)
    }
  }, [isSidebarOpen])

  return (
    <div data-testid="app-shell" className="h-screen w-screen min-w-0 flex bg-background overflow-hidden text-sm relative">
      <div
        data-testid="left-rail"
        className={cn(
            "transition-all duration-300 ease-in-out h-full overflow-hidden border-r bg-sidebar flex-none",
            isSidebarOpen ? "w-[260px] opacity-100" : "w-0 opacity-0 border-none"
        )}
      >
        <LeftRail
          threads={sortedThreads}
          activeThreadId={state.activeThreadId}
          onSelectThread={selectThread}
          onStartThread={() => void startThread().catch(() => undefined)}
          isBusy={isThreadActionBusy}
        />
      </div>

      <div className="flex-1 min-w-0 h-full flex flex-col">
        <header className="h-14 flex-none border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="h-full min-w-0 flex items-center px-4">
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                aria-label="Toggle sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex flex-col leading-tight">
                <div className="truncate text-[14px] font-semibold text-foreground">{activeThreadTitle}</div>
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-2">
              {state.activeTurnId ? (
                <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  turn {state.activeTurnId.slice(0, 8)}
                </div>
              ) : null}
              <div className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {state.connectionStatus}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 min-w-0 flex">
          <div data-testid="center-pane-host" className="flex-1 flex flex-col relative h-full min-w-0">
            <TranscriptPane
              activeThread={activeThread}
              activeThreadId={state.activeThreadId}
              activeTurnId={state.activeTurnId}

              logs={activeLogs}
              inputText={inputText}
              mode={mode}
              onModeChange={setMode}
              connectionStatus={state.connectionStatus}
              onInputTextChange={setInputText}
              onSend={onSend}
              onInterrupt={() => void interruptTurn().catch(() => undefined)}
              historyMore={Boolean(state.activeThreadId && historyCursorByThreadId[state.activeThreadId])}
              historyLoading={activeHistoryLoading}
              onLoadEarlier={() => void loadEarlierHistory().catch(() => undefined)}
              isSending={isSendingTurn}
              isInterrupting={isInterruptingTurn}
              lastRpcError={lastRpcError}
            />
          </div>

          <div
            className="w-[1px] h-full flex-none cursor-col-resize hover:bg-primary/50 bg-border relative group z-[100]"
            onMouseDown={(e) => {
              const startX = e.pageX
              const startWidth = rightRailWidth

              const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = startX - moveEvent.pageX
                const newWidth = clampRightRailWidth(startWidth + deltaX, window.innerWidth, isSidebarOpen)
                setRightRailWidth(newWidth)
              }

              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = 'default'
              }

              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              document.body.style.cursor = 'col-resize'
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>

          <div
            data-testid="right-rail"
            className="flex-none min-w-0 bg-white h-full overflow-hidden overflow-x-hidden"
            style={{ width: rightRailWidth }}
          >
            <PendingInputPane
              pendingInputs={state.pendingInputs}
              selectedInputId={state.selectedInputId}
              onSelectInput={(inputId) => dispatch({ type: 'set_selected_input', inputId })}
              onSubmitInput={(answers) => void submitSelectedInput(answers).catch(() => undefined)}
              submitStatusByInputId={submitStatusByInputId}
              isSubmitting={isSubmittingInput}
              diffSnapshot={diffSnapshot}
              onRefreshDiff={() => void refreshWorkspaceDiff().catch(() => undefined)}
              isRefreshingDiff={isRefreshingDiff}
              staleInputs={activeStaleInputs}
              showHeader
            />
          </div>
        </div>
      </div>
    </div>
  )
}
