import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AppShell } from './app/ui/AppShell'
import { I18nProvider } from './app/i18n/I18nProvider'
import { useAppRuntime } from './app/useAppRuntime'
import { DEFAULT_BRIDGE_URL } from './app/core/constants'
import { RpcClient } from './rpcClient'

type SetupSessionView = {
  id: string
  step: string
  error: string | null
  availableModels: string[]
  modelTier: 'haiku' | 'sonnet' | 'opus' | null
  draft: {
    provider: string | null
    anthropicVendor: string | null
    baseUrl: string
    apiKeyPresent: boolean
    modelMode: 'quick' | 'advanced'
    model: string
    tierModels: Record<'haiku' | 'sonnet' | 'opus', string>
  }
}

type SetupStatusResult = {
  ok: boolean
  complete?: boolean
  restartRequired?: boolean
}

const SETUP_RESTART_REQUIRED_KEY = 'formaxSetupRestartRequired'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const value = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  return typeof value === 'string' && value.trim() ? value : DEFAULT_BRIDGE_URL
}

function resolveSetupRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.endsWith('/setup')
}

function shouldCheckSetupStatus(): boolean {
  if (typeof window === 'undefined') return false
  const setupMode = (window as Window & { __FORMAX_SETUP_MODE__?: unknown }).__FORMAX_SETUP_MODE__
  const pathname = window.location.pathname
  if (setupMode !== 'allow') return false
  if (pathname === '/' || pathname.endsWith('/') || pathname.endsWith('/index.html')) return true
  const lastSegment = pathname.split('/').pop() ?? ''
  return !pathname.endsWith('/setup') && !lastSegment.includes('.')
}

function isDesktopSetupHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.formaxDesktop)
}

function setBrowserSetupRestartRequired(required: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (required) window.localStorage.setItem(SETUP_RESTART_REQUIRED_KEY, '1')
    else window.localStorage.removeItem(SETUP_RESTART_REQUIRED_KEY)
  } catch {
    // Ignore storage failures; the visible setup message remains the source of truth.
  }
}

function BrowserSetupRestartRequired() {
  return (
    <I18nProvider language="en-US">
      <main data-testid="setup-restart-required" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1>Setup complete</h1>
        <p role="alert">Restart the web server, then refresh this page.</p>
      </main>
    </I18nProvider>
  )
}

export function resolveRuntimeRouteAfterSetup(): string {
  if (typeof window === 'undefined') return '/'
  const { pathname, search, hash } = window.location
  if (!pathname.endsWith('/setup')) return `${pathname}${search}${hash}`
  const basePath = pathname.slice(0, -'/setup'.length)
  const runtimePath = basePath ? (basePath.endsWith('/') ? basePath : `${basePath}/`) : '/'
  return `${runtimePath}${search}${hash}`
}

function setupModelInputValue(session: SetupSessionView): string {
  return session.draft.modelMode === 'advanced' && session.modelTier
    ? session.draft.tierModels[session.modelTier]
    : session.draft.model
}

function SetupEntrypoint() {
  const client = useMemo(() => new RpcClient(), [])
  const [status, setStatus] = useState('connecting')
  const [session, setSession] = useState<SetupSessionView | null>(null)
  const [message, setMessage] = useState('')
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [baseUrlValue, setBaseUrlValue] = useState('')
  const [modelValue, setModelValue] = useState('')
  const [setupWritten, setSetupWritten] = useState(false)
  const [setupUnavailable, setSetupUnavailable] = useState(false)
  const [setupRestartRequired, setSetupRestartRequired] = useState(false)
  const [transitionPending, setTransitionPending] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const sessionRef = useRef<SetupSessionView | null>(null)
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const transitionPendingRef = useRef(false)
  const baseUrlValueRef = useRef('')
  const modelValueRef = useRef('')

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    baseUrlValueRef.current = baseUrlValue
  }, [baseUrlValue])

  useEffect(() => {
    modelValueRef.current = modelValue
  }, [modelValue])

  useEffect(() => {
    let cancelled = false
    client.connect(resolveBridgeUrl(), {
      onStatus: (nextStatus) => {
        setStatus(nextStatus)
        if (nextStatus !== 'connected') return
        void client.request('bridge/setup/status')
          .then((statusResult) => {
            const status = statusResult as SetupStatusResult
            if (status.complete === true) {
              client.disconnect()
              if (status.restartRequired === true && !isDesktopSetupHost()) {
                setBrowserSetupRestartRequired(true)
                setSetupRestartRequired(true)
                return null
              }
              setBrowserSetupRestartRequired(false)
              setSetupUnavailable(true)
              return null
            }
            return client.request('bridge/setup/session/create')
          })
          .then((view) => {
            if (cancelled || view == null) return
            const nextSession = view as SetupSessionView
            sessionIdRef.current = nextSession.id
            setSession(nextSession)
          })
          .catch((err) => {
            if (cancelled) return
            const errorMessage = err instanceof Error ? err.message : String(err)
            if (errorMessage.includes('Setup mode is not enabled')) {
              client.disconnect()
              setSetupUnavailable(true)
              return
            }
            setMessage(errorMessage)
          })
      },
      onNotification: () => undefined,
      onError: (err) => {
        if (!cancelled) setMessage(err.message)
      },
    })
    return () => {
      cancelled = true
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void client
          .request('bridge/setup/session/dispose', { sessionId })
          .catch(() => undefined)
          .finally(() => client.disconnect())
      } else {
        client.disconnect()
      }
    }
  }, [client])

  useEffect(() => {
    setApiKeyValue('')
    setSetupWritten(false)
  }, [session?.id])

  useEffect(() => {
    setBaseUrlValue(session?.draft.baseUrl ?? '')
  }, [session?.id, session?.step])

  useEffect(() => {
    if (!session) {
      setModelValue('')
      return
    }
    setModelValue(setupModelInputValue(session))
  }, [session?.id, session?.step, session?.draft.modelMode, session?.modelTier])

  const runAction = async (action: Record<string, unknown>) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    setMessage('')
    try {
      const result = await client.request('bridge/setup/session/action', { sessionId, action })
      if (result?.ok === false) {
        if (result.code === 'session_not_found') {
          const replacement = await client.request('bridge/setup/session/create') as SetupSessionView
          sessionIdRef.current = replacement.id
          setSession(replacement)
        }
        setMessage(String(result.message || 'Setup action failed'))
        return
      }
      const nextSession = result.session as SetupSessionView
      const previousSession = sessionRef.current
      sessionIdRef.current = nextSession.id
      if (action.type === 'setProvider' || action.type === 'setAnthropicVendor') {
        setBaseUrlValue(nextSession.draft.baseUrl)
      }
      if (action.type === 'setBaseUrl' && typeof action.baseUrl === 'string' && baseUrlValueRef.current === action.baseUrl) {
        setBaseUrlValue(nextSession.draft.baseUrl)
      }
      if (
        previousSession &&
        (action.type === 'setProvider' ||
          action.type === 'setAnthropicVendor' ||
          action.type === 'setBaseUrl' ||
          action.type === 'setApiKey' ||
          action.type === 'setModelMode') &&
        modelValueRef.current === setupModelInputValue(previousSession)
      ) {
        setModelValue(setupModelInputValue(nextSession))
      }
      setSession(nextSession)
      setSetupWritten(false)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const applyAction = (action: Record<string, unknown>): Promise<void> => {
    const next = actionQueueRef.current.then(() => runAction(action))
    actionQueueRef.current = next.catch(() => undefined)
    return next
  }

  const applyTransition = (action: Record<string, unknown>): Promise<void> => {
    if (transitionPendingRef.current) return Promise.resolve()
    transitionPendingRef.current = true
    setTransitionPending(true)
    const next = applyAction(action).finally(() => {
      transitionPendingRef.current = false
      setTransitionPending(false)
    })
    return next
  }

  const commit = async () => {
    if (!session || transitionPendingRef.current) return
    try {
      setMessage('')
      if (!setupWritten) {
        await actionQueueRef.current
        const result = await client.request('bridge/setup/session/commit', { sessionId: session.id })
        if (result?.ok === false) {
          setMessage(String(result.message || 'Setup write failed'))
          return
        }
        setSetupWritten(true)
      }
      const desktopCompleted = await window.formaxDesktop?.setup?.complete?.()
      if (window.formaxDesktop && desktopCompleted !== true) {
        setMessage('Setup was written, but desktop restart failed. Retry desktop restart.')
        return
      }
      if (window.formaxDesktop) return
      setBrowserSetupRestartRequired(true)
      setMessage('Setup was written. Restart the web server, then refresh this page.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties
  const canEditModelFields = session?.step !== 'confirm' && session?.step !== 'write'
  const canEditConnectionFields = canEditModelFields && session?.step !== 'modelMode' && session?.step !== 'model'

  if (setupRestartRequired) {
    return <BrowserSetupRestartRequired />
  }

  if (setupUnavailable) {
    const target = resolveRuntimeRouteAfterSetup()
    if (window.location.pathname.endsWith('/setup')) {
      window.history.replaceState(null, '', target)
    }
    return <RuntimeApp />
  }

  return (
    <I18nProvider language="en-US">
      <div style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        {window.formaxDesktop ? (
          <header
            style={{
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              ...dragStyle,
            }}
          >
            <strong>Formax Setup</strong>
            <div style={{ display: 'flex', gap: 8, ...noDragStyle }}>
              <button type="button" onClick={() => void window.formaxDesktop?.windowControls?.minimize?.()}>Minimize</button>
              <button type="button" onClick={() => void window.formaxDesktop?.setup?.cancel?.()}>Close</button>
            </div>
          </header>
        ) : null}
        <main data-testid="setup-entrypoint" style={{ maxWidth: 720, margin: '48px auto', padding: '0 24px' }}>
          <h1>Setup</h1>
        <p>Bridge: {status}</p>
        {message ? <p role="alert">{message}</p> : null}
        {session ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (transitionPendingRef.current) return
              if (session.step === 'write') void commit()
              else void applyTransition({ type: 'next' })
            }}
          >
            <p>Step: {session.step}</p>
            {session.error ? <p role="alert">{session.error}</p> : null}
            <label>
              Provider
              <select
                value={session.draft.provider ?? ''}
                disabled={!canEditConnectionFields}
                onChange={(event) => void applyAction({ type: 'setProvider', provider: event.target.value })}
              >
                <option value="">Select provider</option>
                <option value="anthropic">Anthropic-compatible</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </label>
            {session.draft.provider === 'anthropic' ? (
              <label>
                Anthropic-compatible backend
                <select
                  value={session.draft.anthropicVendor ?? 'deepseek'}
                  disabled={!canEditConnectionFields}
                  onChange={(event) => void applyAction({ type: 'setAnthropicVendor', vendor: event.target.value })}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="glm">GLM</option>
                  <option value="kimi">Kimi</option>
                  <option value="minimax">MiniMax</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            ) : null}
            <label>
              Base URL
              <input
                value={baseUrlValue}
                disabled={!canEditConnectionFields}
                onChange={(event) => {
                  setBaseUrlValue(event.target.value)
                  void applyAction({ type: 'setBaseUrl', baseUrl: event.target.value })
                }}
              />
            </label>
            <label>
              API key
              <input
                type="password"
                value={apiKeyValue}
                placeholder={session.draft.apiKeyPresent ? 'Saved for this setup session' : ''}
                disabled={!canEditConnectionFields}
                onChange={(event) => {
                  setApiKeyValue(event.target.value)
                  void applyAction({ type: 'setApiKey', apiKey: event.target.value })
                }}
              />
            </label>
            <label>
              Model mode
              <select
                value={session.draft.modelMode}
                disabled={!canEditModelFields}
                onChange={(event) => void applyAction({ type: 'setModelMode', mode: event.target.value })}
              >
                <option value="quick">Quick</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              {session.draft.modelMode === 'advanced' && session.modelTier
                ? `${session.modelTier} model`
                : 'Model'}
              <input
                list="setup-models"
                value={modelValue}
                disabled={!canEditModelFields}
                onChange={(event) => {
                  setModelValue(event.target.value)
                  void applyAction({ type: 'setModel', model: event.target.value })
                }}
              />
              <datalist id="setup-models">
                {session.availableModels.map((model) => <option key={model} value={model} />)}
              </datalist>
            </label>
            <div>
              <button type="button" onClick={() => void applyTransition({ type: 'back' })} disabled={transitionPending}>Back</button>
              <button type="submit" disabled={transitionPending}>Next</button>
              <button type="button" onClick={() => void commit()} disabled={session.step !== 'write' || transitionPending}>Write setup</button>
            </div>
          </form>
        ) : null}
        </main>
      </div>
    </I18nProvider>
  )
}

function SetupStatusGate() {
  const client = useMemo(() => new RpcClient(), [])
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [browserRestartRequired, setBrowserRestartRequired] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatusError('')
    setBrowserRestartRequired(false)
    setSetupRequired(null)
    client.connect(resolveBridgeUrl(), {
      onStatus: (nextStatus) => {
        if (nextStatus !== 'connected') return
        void client.request('bridge/setup/status')
          .then((result) => {
            if (cancelled) return
            const status = result as SetupStatusResult
            client.disconnect()
            if (status.complete === true && !isDesktopSetupHost()) {
              if (status.restartRequired === true) {
                setBrowserSetupRestartRequired(true)
                setBrowserRestartRequired(true)
                return
              }
              setBrowserSetupRestartRequired(false)
            }
            setSetupRequired(status.complete !== true)
          })
          .catch((err) => {
            if (!cancelled) {
              client.disconnect()
              setStatusError(err instanceof Error ? err.message : String(err))
            }
          })
      },
      onNotification: () => undefined,
      onError: (err) => {
        if (!cancelled) {
          client.disconnect()
          setStatusError(err.message)
        }
      },
    })
    return () => {
      cancelled = true
      client.disconnect()
    }
  }, [client, retryAttempt])

  if (browserRestartRequired) {
    return <BrowserSetupRestartRequired />
  }

  if (setupRequired === null && !statusError) {
    return (
      <I18nProvider language="en-US">
        <main data-testid="setup-status-gate" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          Checking setup status...
        </main>
      </I18nProvider>
    )
  }

  if (statusError) {
    return (
      <I18nProvider language="en-US">
        <main data-testid="setup-status-error" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1>Setup status unavailable</h1>
          <p role="alert">{statusError}</p>
          <button type="button" onClick={() => setRetryAttempt((value) => value + 1)}>Retry</button>
        </main>
      </I18nProvider>
    )
  }

  return setupRequired ? <SetupEntrypoint /> : <RuntimeApp />
}

function RuntimeApp() {
  const shellProps = useAppRuntime()
  return (
    <I18nProvider language={shellProps.userSettings.language}>
      <AppShell {...shellProps} />
    </I18nProvider>
  )
}

export function App() {
  if (resolveSetupRoute()) return <SetupEntrypoint />
  if (shouldCheckSetupStatus()) return <SetupStatusGate />
  return <RuntimeApp />
}
