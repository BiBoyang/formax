import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from './app/ui/AppShell'
import { I18nProvider } from './app/i18n/I18nProvider'
import { useAppRuntime } from './app/useAppRuntime'
import { DEFAULT_BRIDGE_URL } from './app/core/constants'
import { RpcClient } from './rpcClient'
import {
  MODEL_TIERS,
  SetupRestartRequired,
  SetupShell,
  SetupWizardScreen,
  setupModelInputValue,
  type SetupAction,
  type SetupRestartRequiredKind,
  type SetupSessionView,
} from './setup/SetupWizardScreen'
import { Button } from './components/ui/button'

type SetupStatusResult = {
  ok: boolean
  complete?: boolean
  restartRequired?: boolean
}

const SETUP_RESTART_REQUIRED_KEY = 'formaxSetupRestartRequired'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const value = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  if (typeof value === 'string' && value.trim()) return value
  const envBridgeUrl = import.meta.env.VITE_FORMAX_BRIDGE_URL
  if (typeof envBridgeUrl === 'string' && envBridgeUrl.trim()) return envBridgeUrl
  const desktopBridgePort = window.formaxDesktop?.bridgePort
  if (typeof desktopBridgePort === 'number' && Number.isInteger(desktopBridgePort) && desktopBridgePort >= 1 && desktopBridgePort <= 65535) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hostname = window.location.hostname || '127.0.0.1'
    return `${protocol}//${hostname}:${desktopBridgePort}`
  }
  return DEFAULT_BRIDGE_URL
}

function resolveSetupRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.endsWith('/setup')
}

function shouldCheckSetupStatus(): boolean {
  if (typeof window === 'undefined') return false
  const injectedSetupMode = (window as Window & { __FORMAX_SETUP_MODE__?: unknown }).__FORMAX_SETUP_MODE__
  const setupMode = injectedSetupMode ?? import.meta.env.VITE_FORMAX_SETUP_MODE
  const pathname = window.location.pathname
  if (setupMode !== 'allow') return false
  if (pathname === '/' || pathname.endsWith('/') || pathname.endsWith('/index.html')) return true
  const lastSegment = pathname.split('/').pop() ?? ''
  return !pathname.endsWith('/setup') && !lastSegment.includes('.')
}

function isDesktopSetupHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.formaxDesktop)
}

function isManagedDesktopSetupHost(): boolean {
  return typeof window !== 'undefined' && window.formaxDesktop?.managedRuntime === true
}

function readSetupRestartRequired(): SetupRestartRequiredKind | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(SETUP_RESTART_REQUIRED_KEY)
    if (value === 'desktop') return 'desktop'
    if (value === 'browser' || value === '1') return 'browser'
  } catch {
    return null
  }
  return null
}

function setSetupRestartRequiredStorage(kind: SetupRestartRequiredKind | null): void {
  if (typeof window === 'undefined') return
  try {
    if (kind) window.localStorage.setItem(SETUP_RESTART_REQUIRED_KEY, kind)
    else window.localStorage.removeItem(SETUP_RESTART_REQUIRED_KEY)
  } catch {
    // Ignore storage failures; the visible setup message remains the source of truth.
  }
}

export function resolveRuntimeRouteAfterSetup(): string {
  if (typeof window === 'undefined') return '/'
  const { pathname, search, hash } = window.location
  if (!pathname.endsWith('/setup')) return `${pathname}${search}${hash}`
  const basePath = pathname.slice(0, -'/setup'.length)
  const runtimePath = basePath ? (basePath.endsWith('/') ? basePath : `${basePath}/`) : '/'
  return `${runtimePath}${search}${hash}`
}

type DesktopSetupHandoffKind = 'already-configured' | 'setup-unavailable'
type DesktopSetupHandoffAction = 'open-main' | 'complete'

type DesktopSetupHandoffState = {
  kind: DesktopSetupHandoffKind
  action: DesktopSetupHandoffAction
  status: 'pending' | 'failed'
  message: string
}

function SetupDesktopHostHandoff({
  state,
  onRetry,
}: {
  state: DesktopSetupHandoffState
  onRetry: () => void
}) {
  const title = state.kind === 'already-configured' ? 'Setup is ready' : 'Setup unavailable'
  return (
    <SetupShell>
      <main data-testid="setup-desktop-handoff" className="flex flex-col items-center gap-4 text-center">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[20px] font-bold tracking-tight">{title}</h1>
          <p className="ui-text-meta text-muted-foreground" role={state.status === 'failed' ? 'alert' : undefined}>
            {state.message}
          </p>
        </div>
        {state.status === 'failed' ? (
          <Button type="button" size="sm" onClick={onRetry}>Retry</Button>
        ) : null}
      </main>
    </SetupShell>
  )
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
  const [setupRestartRequired, setSetupRestartRequired] = useState<SetupRestartRequiredKind | null>(null)
  const [desktopHandoff, setDesktopHandoff] = useState<DesktopSetupHandoffState | null>(null)
  const [transitionPending, setTransitionPending] = useState(false)
  const [commitPending, setCommitPending] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const sessionRef = useRef<SetupSessionView | null>(null)
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const transitionPendingRef = useRef(false)
  const commitPendingRef = useRef(false)
  const desktopHandoffPendingRef = useRef(false)
  const baseUrlValueRef = useRef('')
  const modelValueRef = useRef('')

  const requestManagedDesktopHandoff = useCallback(async (
    kind: DesktopSetupHandoffKind,
    action: DesktopSetupHandoffAction,
  ) => {
    if (!isManagedDesktopSetupHost()) return false
    if (desktopHandoffPendingRef.current) return true
    desktopHandoffPendingRef.current = true
    setDesktopHandoff({
      kind,
      action,
      status: 'pending',
      message: 'Opening Formax...',
    })
    const failHandoff = (message: string) => {
      setDesktopHandoff({
        kind,
        action,
        status: 'failed',
        message,
      })
      desktopHandoffPendingRef.current = false
    }
    const unsubscribe = window.formaxDesktop?.setup?.subscribe?.((event) => {
      if (event.action !== action) return
      unsubscribe?.()
      if (event.ok === true) {
        desktopHandoffPendingRef.current = false
        return
      }
      failHandoff('Desktop handoff failed. Retry setup handoff.')
    })
    const handoff = action === 'complete'
      ? window.formaxDesktop?.setup?.complete?.()
      : window.formaxDesktop?.setup?.openMain?.()
    if (!handoff) {
      unsubscribe?.()
      failHandoff('Desktop handoff failed. Retry setup handoff.')
      return true
    }
    void handoff
      .then((accepted) => {
        if (accepted === true) return
        unsubscribe?.()
        failHandoff('Desktop handoff failed. Retry setup handoff.')
      })
      .catch((err) => {
        unsubscribe?.()
        failHandoff(err instanceof Error ? err.message : String(err))
      })
    return true
  }, [])

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
              if (status.restartRequired === true) {
                if (isDesktopSetupHost()) {
                  if (window.formaxDesktop?.managedRuntime === true) {
                    void requestManagedDesktopHandoff('already-configured', 'complete')
                  } else {
                    setSetupRestartRequiredStorage('desktop')
                    setSetupRestartRequired('desktop')
                  }
                  return null
                } else {
                  setSetupRestartRequiredStorage('browser')
                  setSetupRestartRequired('browser')
                  return null
                }
              }
              if (isManagedDesktopSetupHost()) {
                void requestManagedDesktopHandoff('already-configured', 'open-main')
                return null
              }
              if (readSetupRestartRequired()) {
                setSetupRestartRequiredStorage(null)
                setSetupRestartRequired(null)
              }
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
              if (isManagedDesktopSetupHost()) {
                void requestManagedDesktopHandoff('setup-unavailable', 'open-main')
                return
              }
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
  }, [client, requestManagedDesktopHandoff])

  useEffect(() => {
    setApiKeyValue('')
    setSetupWritten(false)
  }, [session?.id])

  useEffect(() => {
    setBaseUrlValue(session?.draft.baseUrl ?? '')
  }, [session?.id, session?.step])

  useEffect(() => {
    if (!session || (session.step !== 'modelMode' && session.step !== 'model') || transitionPendingRef.current) return
    const defaultModel = session.availableModels[0]
    if (!defaultModel) return
    if (session.draft.modelMode === 'quick') {
      if (!session.draft.model.trim()) void applyAction({ type: 'setModel', model: defaultModel })
      return
    }
    for (const tier of MODEL_TIERS) {
      if (!session.draft.tierModels[tier].trim()) {
        void applyAction({ type: 'setTierModel', tier, model: defaultModel })
      }
    }
  }, [session?.id, session?.step, session?.draft.modelMode, session?.availableModels.join('|')])

  useEffect(() => {
    if (!session) {
      setModelValue('')
      return
    }
    setModelValue(setupModelInputValue(session))
  }, [session?.id, session?.step, session?.draft.modelMode, session?.modelTier])

  const runAction = async (action: SetupAction): Promise<SetupSessionView | null> => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return null
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
        return null
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
      return nextSession
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  const applyAction = (action: SetupAction): Promise<SetupSessionView | null> => {
    const next = actionQueueRef.current.then(() => runAction(action))
    actionQueueRef.current = next.then(() => undefined, () => undefined)
    return next
  }

  const applyTransition = (action: SetupAction): Promise<SetupSessionView | null> => {
    if (transitionPendingRef.current) return Promise.resolve(null)
    transitionPendingRef.current = true
    setTransitionPending(true)
    const next = applyAction(action).finally(() => {
      transitionPendingRef.current = false
      setTransitionPending(false)
    })
    return next
  }

  useEffect(() => {
    if (session?.step !== 'welcome' || transitionPendingRef.current) return
    void applyTransition({ type: 'next' })
  }, [session?.id, session?.step])

  const commit = async () => {
    if (!session || transitionPendingRef.current || commitPendingRef.current) return
    commitPendingRef.current = true
    setCommitPending(true)
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
      const desktopBridge = window.formaxDesktop
      if (desktopBridge) {
        if (desktopBridge.managedRuntime === true) {
          const desktopCompleted = await desktopBridge.setup?.complete?.()
          if (desktopCompleted !== true) {
            setMessage('Setup was written, but desktop restart failed. Retry desktop restart.')
            return
          }
          return
        }
        setSetupRestartRequiredStorage('desktop')
        setSetupRestartRequired('desktop')
        return
      }
      setSetupRestartRequiredStorage('browser')
      setMessage('Setup was written. Restart the web server, then refresh this page.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      commitPendingRef.current = false
      setCommitPending(false)
    }
  }

  const canEditModelFields = session?.step !== 'confirm' && session?.step !== 'write'
  const canEditConnectionFields = canEditModelFields && session?.step !== 'modelMode' && session?.step !== 'model'
  const setupOperationPending = transitionPending || commitPending

  if (setupRestartRequired) {
    return <SetupRestartRequired kind={setupRestartRequired} />
  }

  if (desktopHandoff) {
    return (
      <SetupDesktopHostHandoff
        state={desktopHandoff}
        onRetry={() => {
          void requestManagedDesktopHandoff(desktopHandoff.kind, desktopHandoff.action)
        }}
      />
    )
  }

  if (setupUnavailable) {
    const target = resolveRuntimeRouteAfterSetup()
    if (window.location.pathname.endsWith('/setup')) {
      window.history.replaceState(null, '', target)
    }
    return <RuntimeApp />
  }

  return (
    <SetupWizardScreen
      status={status}
      session={session}
      message={message}
      apiKeyValue={apiKeyValue}
      baseUrlValue={baseUrlValue}
      modelValue={modelValue}
      operationPending={setupOperationPending}
      canEditConnectionFields={canEditConnectionFields}
      canEditModelFields={canEditModelFields}
      onAction={applyAction}
      onTransition={applyTransition}
      onCommit={commit}
      onApiKeyValueChange={setApiKeyValue}
      onBaseUrlValueChange={setBaseUrlValue}
      onModelValueChange={setModelValue}
    />
  )
}

function SetupStatusGate() {
  const client = useMemo(() => new RpcClient(), [])
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [restartRequired, setRestartRequired] = useState<SetupRestartRequiredKind | null>(null)
  const [statusError, setStatusError] = useState('')
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatusError('')
    setRestartRequired(null)
    setSetupRequired(null)
    client.connect(resolveBridgeUrl(), {
      onStatus: (nextStatus) => {
        if (nextStatus !== 'connected') return
        void client.request('bridge/setup/status')
          .then((result) => {
            if (cancelled) return
            const status = result as SetupStatusResult
            client.disconnect()
            if (status.complete === true) {
              if (status.restartRequired === true) {
                if (isDesktopSetupHost()) {
                  if (window.formaxDesktop?.managedRuntime !== true) {
                    setSetupRestartRequiredStorage('desktop')
                    setRestartRequired('desktop')
                    return
                  }
                } else {
                  setSetupRestartRequiredStorage('browser')
                  setRestartRequired('browser')
                  return
                }
              }
              if (readSetupRestartRequired()) {
                setSetupRestartRequiredStorage(null)
                setRestartRequired(null)
              }
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

  if (restartRequired) {
    return <SetupRestartRequired kind={restartRequired} />
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
