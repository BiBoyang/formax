import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LeftRail } from './components/LeftRail'
import { PendingInputPane } from './components/PendingInputPane'
import { TranscriptPane } from './components/TranscriptPane'
import { RpcClient, RpcRequestError } from './rpcClient'
import { PanelLeft } from 'lucide-react'
import { appReducer, initialAppState } from './store'
import type { PendingInput, ResolvedInput, RpcNotification, ThreadMessage, ThreadSummary, TranscriptItem } from './types'
import { cn } from './lib/utils' // Assuming cn utility is available
import { Button } from './components/ui/button' // Assuming Button component is available

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3777'
const RIGHT_RAIL_MIN_WIDTH = 280
const RIGHT_RAIL_MAX_WIDTH = 680
const CENTER_MIN_WIDTH = 560
const SIDEBAR_WIDTH = 260
const DIVIDER_WIDTH = 1

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
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    clampRightRailWidth(400, typeof window === 'undefined' ? 1600 : window.innerWidth, true),
  )
  const [logsByThreadId, setLogsByThreadId] = useState<Record<string, TranscriptItem[]>>({})
  const [historyCursorByThreadId, setHistoryCursorByThreadId] = useState<Record<string, string | null>>({})
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const activeThreadIdRef = useRef<string | null>(state.activeThreadId)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])

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

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    client.notify('initialized')
  }, [])

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      const params = (notification.params ?? {}) as any
      switch (notification.method) {
        case 'turn/started': {
          const turnId = String(params?.turn?.id ?? '')
          dispatch({ type: 'set_active_turn', turnId: turnId || null })
          break
        }

        case 'turn/completed': {
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            dispatch({ type: 'finalize_turn_thinking', turnId })
          }
          dispatch({ type: 'set_active_turn', turnId: null })
          const command = turnId ? commandByTurnRef.current.get(turnId) : undefined
          if (command && turnId) {
            commandByTurnRef.current.delete(turnId)
          }
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/failed': {
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            dispatch({ type: 'finalize_turn_thinking', turnId })
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
          const turnId = String(params?.turnId ?? '')
          const eventType = params?.event?.type
          if (eventType === 'assistant_delta') {
            dispatch({
              type: 'append_assistant_delta',
              turnId,
              text: String(params?.event?.text ?? ''),
            })
            break
          }

          if (eventType === 'thinking_delta') {
            const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
            if (text) {
              dispatch({
                type: 'append_thinking_delta',
                turnId,
                text,
              })
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
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          dispatch({ type: 'input_requested', input })
          break
        }

        case 'turn/inputResolved': {
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
    [log, refreshWorkspaceDiff],
  )

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
          void initializeHandshake()
            .then(async () => {
              await Promise.all([refreshThreads(), refreshWorkspaceDiff()])
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
  }, [bridgeUrl, captureError, handleNotification, initializeHandshake, refreshThreads, refreshWorkspaceDiff])

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
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [selectedInput.inputId]: {
          status,
          kind: status === 'conflict_already_submitted' ? 'error' : 'success',
          message:
            status === 'already_submitted_same'
              ? 'Same answer already accepted'
              : status === 'conflict_already_submitted'
                ? 'Different answer conflicts with previous submission'
                : status,
        },
      }))
      log(`Input submit: ${status}`, status === 'conflict_already_submitted' ? 'error' : 'info', selectedInput.turnId)
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
    },
    [loadThreadHistory, log, logsByThreadId, state.activeThreadId, state.logs],
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

      <div data-testid="center-pane-host" className="flex-1 flex flex-col relative h-full min-w-0">
        <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 left-4 z-50 h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        >
            <PanelLeft className="h-4 w-4" />
        </Button>
        <TranscriptPane
          activeThread={activeThread}
          activeThreadId={state.activeThreadId}
          activeTurnId={state.activeTurnId}

          logs={activeLogs}
          inputText={inputText}
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

      {/* Draggable Divider */}
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

      {/* Right Rail Container - dynamic width */}
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
        />
      </div>
    </div>
  )
}
