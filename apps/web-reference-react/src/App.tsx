import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LeftRail } from './components/LeftRail'
import { PendingInputPane } from './components/PendingInputPane'
import { TranscriptPane } from './components/TranscriptPane'
import { RpcClient, RpcRequestError } from './rpcClient'
import { PanelLeft } from 'lucide-react'
import { appReducer, initialAppState } from './store'
import type { PendingInput, ResolvedInput, RpcNotification, ThreadSummary } from './types'
import { cn } from './lib/utils' // Assuming cn utility is available
import { Button } from './components/ui/button' // Assuming Button component is available

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3777'

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

function summarizeToolEvent(event: any): string {
  if (!event || typeof event !== 'object') return 'tool event'
  if (event.type === 'tool_start') return `start ${String(event.name ?? 'tool')} (${String(event.id ?? '')})`
  if (event.type === 'tool_end') return `end ${String(event.id ?? '')}`
  if (event.type === 'tool_input') return `input ${String(event.id ?? '')}`
  if (event.type === 'tool_update') {
    const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
    const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
    const line = transcriptLines[transcriptLines.length - 1] ?? middleLines[middleLines.length - 1]
    if (line && String(line).trim()) return String(line)
    if (typeof event.toolUses === 'number') return `update tool uses ${event.toolUses}`
    return `update ${String(event.id ?? '')}`
  }
  return String(event.type ?? 'tool event')
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
  const [rightRailWidth, setRightRailWidth] = useState(400)
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const lastConnectionStatusRef = useRef(state.connectionStatus)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null

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

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    client.notify('initialized')
    log('Initialized app-server handshake')
  }, [log])

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      const params = (notification.params ?? {}) as any
      switch (notification.method) {
        case 'turn/started': {
          const turnId = String(params?.turn?.id ?? '')
          dispatch({ type: 'set_active_turn', turnId: turnId || null })
          if (turnId) log(`Turn started: ${turnId}`, 'info', turnId)
          break
        }

        case 'turn/completed': {
          const turnId = String(params?.turn?.id ?? '')
          dispatch({ type: 'set_active_turn', turnId: null })
          const command = turnId ? commandByTurnRef.current.get(turnId) : undefined
          if (command) {
            log(`Command completed: ${command}`, 'info', turnId)
            commandByTurnRef.current.delete(turnId)
          } else {
            log('Turn completed', 'info', turnId || undefined)
          }
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/failed': {
          const turnId = String(params?.turn?.id ?? '')
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
            dispatch({
              type: 'append_tool_event',
              turnId,
              toolUseId: String(params?.event?.id ?? ''),
              toolName: params?.event?.name ? String(params.event.name) : undefined,
              phase: eventType === 'tool_start' ? 'start' : eventType === 'tool_update' ? 'update' : 'end',
              text: summarizeToolEvent(params?.event),
            })
            break
          }

          if (eventType === 'error') {
            log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
            break
          }

          if (eventType === 'tool_input') {
            dispatch({
              type: 'append_tool_event',
              turnId,
              toolUseId: String(params?.event?.id ?? ''),
              phase: 'update',
              text: summarizeToolEvent(params?.event),
            })
            break
          }

          if (eventType && eventType !== 'thinking_stop') {
            log(`Event ${String(eventType)}`, 'info', turnId)
          }
          break
        }

        case 'turn/inputRequested': {
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          dispatch({ type: 'input_requested', input })
          log(`Input requested: ${input.kind} (${input.toolUseId})`, 'warn', input.turnId)
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
    const client = new RpcClient()
    clientRef.current = client
    client.connect(bridgeUrl, {
      onStatus: (connectionStatus) => {
        if (lastConnectionStatusRef.current !== connectionStatus) {
          const ts = new Date().toISOString()
          dispatch({
            type: 'push_log',
            text: `[connection ${ts}] ${lastConnectionStatusRef.current} -> ${connectionStatus}`,
            level: connectionStatus === 'disconnected' ? 'warn' : 'info',
          })
          lastConnectionStatusRef.current = connectionStatus
        }
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
    setIsThreadActionBusy(true)
    try {
      const result = await request('thread/start', {})
      const thread = result?.thread as { id?: string } | undefined
      if (thread?.id) {
        dispatch({ type: 'set_active_thread', threadId: thread.id })
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

  const activeThread = useMemo(
    () => state.threads.find((t) => t.id === state.activeThreadId),
    [state.threads, state.activeThreadId],
  )

  return (
    <div className="h-screen w-screen flex bg-background overflow-hidden text-sm relative">
      <div
        className={cn(
            "transition-all duration-300 ease-in-out h-full overflow-hidden border-r bg-sidebar flex-none",
            isSidebarOpen ? "w-[260px] opacity-100" : "w-0 opacity-0 border-none"
        )}
      >
        <LeftRail
          threads={sortedThreads}
          activeThreadId={state.activeThreadId}
          onSelectThread={(threadId) => dispatch({ type: 'set_active_thread', threadId })}
          onStartThread={() => void startThread().catch(() => undefined)}
          isBusy={isThreadActionBusy}
        />
      </div>

      <div className="flex-1 flex flex-col relative h-full min-w-0">
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

          logs={state.logs}
          inputText={inputText}
          connectionStatus={state.connectionStatus}
          onInputTextChange={setInputText}
          onSend={onSend}
          onInterrupt={() => void interruptTurn().catch(() => undefined)}
          isSending={isSendingTurn}
          isInterrupting={isInterruptingTurn}
          lastRpcError={lastRpcError}
          selectedInput={selectedInput}
          onSubmitInput={(answers) => void submitSelectedInput(answers).catch(() => undefined)}
          submitStatusByInputId={submitStatusByInputId}
          isSubmittingInput={isSubmittingInput}
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
                const newWidth = Math.max(200, Math.min(800, startWidth + deltaX))
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
        className="flex-none bg-white h-full overflow-hidden" 
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
