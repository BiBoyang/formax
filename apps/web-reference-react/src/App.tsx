import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LeftRail } from './components/LeftRail'
import { PendingInputPane } from './components/PendingInputPane'
import { TranscriptPane } from './components/TranscriptPane'
import { RpcClient } from './rpcClient'
import { appReducer, initialAppState } from './store'
import type { PendingInput, RpcNotification, ThreadSummary } from './types'

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3777'

function asThreadSummaries(value: unknown): ThreadSummary[] {
  if (!value || typeof value !== 'object') return []
  const data = (value as { data?: unknown }).data
  return Array.isArray(data) ? (data as ThreadSummary[]) : []
}

export function App() {
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL)
  const [inputText, setInputText] = useState('')
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const clientRef = useRef<RpcClient | null>(null)
  const lastConnectionStatusRef = useRef(state.connectionStatus)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info') => {
    dispatch({ type: 'push_log', text, level })
  }, [])

  const request = useCallback(async (method: string, params?: unknown): Promise<any> => {
    const client = clientRef.current
    if (!client) throw new Error('RPC client is not ready')
    return client.request(method, params)
  }, [])

  const refreshThreads = useCallback(async () => {
    const result = await request('thread/list', { limit: 50 })
    dispatch({ type: 'set_threads', threads: asThreadSummaries(result) })
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
        case 'turn/started':
          dispatch({ type: 'set_active_turn', turnId: params?.turn?.id ?? null })
          break

        case 'turn/completed':
          dispatch({ type: 'set_active_turn', turnId: null })
          log('Turn completed')
          break

        case 'turn/failed':
          dispatch({ type: 'set_active_turn', turnId: null })
          log(`Turn failed: ${params?.error ?? 'unknown'}`, 'error')
          break

        case 'turn/event': {
          const eventType = params?.event?.type
          if (eventType === 'assistant_delta') {
            dispatch({
              type: 'append_assistant_delta',
              turnId: String(params?.turnId ?? ''),
              text: String(params?.event?.text ?? ''),
            })
          }
          if (eventType === 'thinking_delta') {
            const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
            if (text) {
              dispatch({
                type: 'append_thinking_delta',
                turnId: String(params?.turnId ?? ''),
                text,
              })
            }
          }
          if (eventType === 'error') {
            log(String(params?.event?.error ?? 'Stream error'), 'error')
          }
          break
        }

        case 'turn/inputRequested': {
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          dispatch({ type: 'input_requested', input })
          log(`Input requested: ${input.kind} (${input.toolUseId})`, 'warn')
          break
        }

        case 'turn/inputResolved': {
          const inputId = params?.input?.inputId as string | undefined
          if (!inputId) break
          dispatch({ type: 'input_resolved', inputId, status: String(params?.input?.status ?? 'unknown') })
          break
        }

        default:
          break
      }
    },
    [log],
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
          void initializeHandshake().then(refreshThreads).catch((err) => log(String(err), 'error'))
        }
      },
      onNotification: handleNotification,
      onError: (err) => log(err.message, 'error'),
    })

    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [bridgeUrl, handleNotification, initializeHandshake, log, refreshThreads])

  const sortedThreads = useMemo(
    () => [...state.threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [state.threads],
  )

  const startThread = async () => {
    const result = await request('thread/start', {})
    const thread = result?.thread as { id?: string } | undefined
    if (thread?.id) {
      dispatch({ type: 'set_active_thread', threadId: thread.id })
      await refreshThreads()
      log(`Thread created: ${thread.id}`)
    }
  }

  const startTurn = async () => {
    if (!state.activeThreadId) {
      log('Please select or create a thread first', 'warn')
      return
    }

    const text = inputText.trim()
    if (!text) return

    dispatch({ type: 'push_message', role: 'user', text })
    setInputText('')

    const result = await request('turn/start', {
      threadId: state.activeThreadId,
      input: { text },
    })
    const turnId = (result as any)?.turn?.id
    if (turnId) {
      dispatch({ type: 'set_active_turn', turnId: String(turnId) })
    }
  }

  const interruptTurn = async () => {
    if (!state.activeThreadId || !state.activeTurnId) return
    await request('turn/interrupt', {
      threadId: state.activeThreadId,
      turnId: state.activeTurnId,
    })
  }

  const submitSelectedInput = async (answers: Record<string, string>) => {
    if (!selectedInput) return
    const response = await request('turn/input/submit', {
      threadId: selectedInput.threadId,
      turnId: selectedInput.turnId,
      inputId: selectedInput.inputId,
      toolUseId: selectedInput.toolUseId,
      answers,
      submissionId: `web-${Date.now()}`,
    })
    log(`Input submit: ${(response as { status?: string })?.status ?? 'unknown'}`)
  }

  const onSend = (event: FormEvent) => {
    event.preventDefault()
    void startTurn().catch((err) => log(String(err), 'error'))
  }

  return (
    <div className="app-shell">
      <LeftRail
        connectionStatus={state.connectionStatus}
        bridgeUrl={bridgeUrl}
        onBridgeUrlChange={setBridgeUrl}
        threads={sortedThreads}
        activeThreadId={state.activeThreadId}
        onSelectThread={(threadId) => dispatch({ type: 'set_active_thread', threadId })}
        onStartThread={() => void startThread().catch((err) => log(String(err), 'error'))}
        onRefreshThreads={() => void refreshThreads().catch((err) => log(String(err), 'error'))}
      />

      <TranscriptPane
        activeThreadId={state.activeThreadId}
        activeTurnId={state.activeTurnId}
        logs={state.logs}
        inputText={inputText}
        connectionStatus={state.connectionStatus}
        onInputTextChange={setInputText}
        onSend={onSend}
        onInterrupt={() => void interruptTurn().catch((err) => log(String(err), 'error'))}
      />

      <PendingInputPane
        pendingInputs={state.pendingInputs}
        selectedInputId={state.selectedInputId}
        onSelectInput={(inputId) => dispatch({ type: 'set_selected_input', inputId })}
        onSubmitInput={(answers) => void submitSelectedInput(answers).catch((err) => log(String(err), 'error'))}
      />
    </div>
  )
}
