import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, resolveRuntimeRouteAfterSetup } from './App'

vi.mock('./app/core/userSettings', async () => {
  const actual = await vi.importActual<typeof import('./app/core/userSettings')>('./app/core/userSettings')
  return {
    ...actual,
    DEFAULT_USER_SETTINGS: { ...actual.DEFAULT_USER_SETTINGS, language: 'en-US' },
  }
})
import {
  clickWindowTransparencyMenuItem,
  createDesktopWindowAppearanceState,
} from './test/appTestHarness'

const ORIGINAL_CANVAS_GET_CONTEXT = HTMLCanvasElement.prototype.getContext

function createSetupSessionView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'setup-1',
    step: 'provider',
    error: null,
    availableModels: [],
    modelTier: null,
    draft: {
      provider: null,
      anthropicVendor: null,
      baseUrl: '',
      apiKeyPresent: false,
      modelMode: 'quick',
      model: '',
      tierModels: { haiku: '', sonnet: '', opus: '' },
    },
    ...overrides,
  }
}

function createCompleteSetupDraft(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'anthropic',
    anthropicVendor: 'deepseek',
    baseUrl: 'https://api.example.com',
    apiKeyPresent: true,
    modelMode: 'quick',
    model: 'sonnet-model',
    tierModels: { haiku: '', sonnet: '', opus: '' },
    ...overrides,
  }
}

function installDesktopBridge(overrides: Partial<FormaxDesktopBridge> = {}): () => void {
  const originalDesktopBridge = window.formaxDesktop
  const { setup: setupOverrides, ...bridgeOverrides } = overrides
  window.formaxDesktop = {
    mode: 'dev',
    startUrl: 'http://127.0.0.1:3781',
    managedRuntime: true,
    windowControls: {},
    ...bridgeOverrides,
    setup: {
      complete: vi.fn(async () => true),
      cancel: vi.fn(async () => true),
      openMain: vi.fn(async () => true),
      ...setupOverrides,
    },
  }

  return () => {
    if (originalDesktopBridge) {
      window.formaxDesktop = originalDesktopBridge
    } else {
      delete window.formaxDesktop
    }
  }
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

beforeEach(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  }
  if (!window.sessionStorage) {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createMemoryStorage(),
    })
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  })
})

afterEach(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: ORIGINAL_CANVAS_GET_CONTEXT,
  })
})

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    loadAddon() {}
    open() {}
    onData() {
      return { dispose() {} }
    }
    write() {}
    reset() {}
    focus() {}
    dispose() {}
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit() {}
  }
  return { FitAddon: MockFitAddon }
})

const rpcMock = vi.hoisted(() => {
  const CANONICAL_SOURCES = new Set(['engine', 'tool', 'policy', 'system', 'ui'])
  let requestImpl: (method: string, params: unknown) => unknown = () => ({})
  let onNotification: ((notification: { method: string; params?: unknown }) => void) | null = null
  const requests: Array<{ method: string; params: unknown }> = []
  const connectUrls: string[] = []
  const disconnects: string[] = []
  let replaySeqCounter = 0

  function inferThreadId(params: Record<string, unknown>): string | null {
    if (typeof params.threadId === 'string' && params.threadId.trim()) return params.threadId
    const turn = params.turn
    if (turn && typeof turn === 'object') {
      const turnThreadId = (turn as Record<string, unknown>).threadId
      if (typeof turnThreadId === 'string' && turnThreadId.trim()) return turnThreadId
    }
    const input = params.input
    if (input && typeof input === 'object') {
      const inputThreadId = (input as Record<string, unknown>).threadId
      if (typeof inputThreadId === 'string' && inputThreadId.trim()) return inputThreadId
    }
    return null
  }

  function inferTurnId(method: string, params: Record<string, unknown>): string | null {
    if (method === 'turn/completed' || method === 'turn/failed') {
      const turn = params.turn
      if (turn && typeof turn === 'object') {
        const turnId = (turn as Record<string, unknown>).id
        if (typeof turnId === 'string' && turnId.trim()) return turnId
      }
      return null
    }
    if (typeof params.turnId === 'string' && params.turnId.trim()) return params.turnId
    const input = params.input
    if (input && typeof input === 'object') {
      const turnId = (input as Record<string, unknown>).turnId
      if (typeof turnId === 'string' && turnId.trim()) return turnId
    }
    return null
  }

  function inferSource(method: string, params: Record<string, unknown>): string {
    if (CANONICAL_SOURCES.has(String(params.source))) return String(params.source)
    if (method === 'turn/inputRequested' || method === 'turn/inputResolved') {
      const input = params.input
      const kind =
        input && typeof input === 'object' ? (input as Record<string, unknown>).kind : undefined
      return kind === 'approval' ? 'policy' : 'tool'
    }
    if (method === 'turn/event') {
      const event = params.event
      const type =
        event && typeof event === 'object' ? String((event as Record<string, unknown>).type ?? '') : ''
      if (type.startsWith('tool_')) return 'tool'
      if (type === 'error') return 'system'
      return 'engine'
    }
    if (method === 'turn/failed') return 'system'
    return 'engine'
  }

  function enrichNotification(notification: { method: string; params?: unknown }) {
    const method = notification.method
    if (
      method !== 'turn/event' &&
      method !== 'turn/completed' &&
      method !== 'turn/failed' &&
      method !== 'turn/inputRequested' &&
      method !== 'turn/inputResolved'
    ) {
      return notification
    }
    const params =
      notification.params && typeof notification.params === 'object'
        ? ({ ...(notification.params as Record<string, unknown>) } as Record<string, unknown>)
        : {}
    const threadId = inferThreadId(params)
    if (threadId && (typeof params.threadId !== 'string' || !params.threadId.trim())) {
      params.threadId = threadId
    }
    const turnId = inferTurnId(method, params)
    if (
      method !== 'turn/completed' &&
      method !== 'turn/failed' &&
      turnId &&
      (typeof params.turnId !== 'string' || !params.turnId.trim())
    ) {
      params.turnId = turnId
    }
    const replaySeqRaw = params.replaySeq
    const seqRaw = params.seq
    const seq =
      typeof seqRaw === 'number' && Number.isFinite(seqRaw) && seqRaw > 0 ? seqRaw : null
    const replaySeq =
      typeof replaySeqRaw === 'number' && Number.isFinite(replaySeqRaw) && replaySeqRaw > 0
        ? replaySeqRaw
        : (seq ?? replaySeqCounter + 1)
    replaySeqCounter = Math.max(replaySeqCounter + 1, replaySeq)
    params.replaySeq = replaySeq
    const eventIdRaw = typeof params.eventId === 'string' ? params.eventId.trim() : ''
    if (!eventIdRaw) {
      const eventTurnId = turnId ?? 'turn'
      params.eventId = `${eventTurnId}:${replaySeq}`
    }
    const tsRaw = typeof params.ts === 'string' ? params.ts.trim() : ''
    if (!tsRaw) {
      params.ts = new Date(1700000000000 + replaySeq * 1000).toISOString()
    }
    params.source = inferSource(method, params)
    return { method, params }
  }

  return {
    requests,
    connectUrls,
    disconnects,
    setRequestImpl(impl: (method: string, params: unknown) => unknown) {
      requestImpl = impl
    },
    getRequestImpl() {
      return requestImpl
    },
    callRequest(method: string, params: unknown) {
      requests.push({ method, params })
      const raw = requestImpl(method, params)
      if (method !== 'thread/replay' || !raw || typeof raw !== 'object') return raw
      const record = raw as Record<string, unknown>
      const data = Array.isArray(record.data) ? record.data : null
      if (!data) return raw
      const nextData = data.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const replayEntry = entry as Record<string, unknown>
        const method = typeof replayEntry.method === 'string' ? replayEntry.method : ''
        const params = replayEntry.params
        if (!method) return entry
        const enriched = enrichNotification({
          method,
          ...(params && typeof params === 'object' ? { params: params as Record<string, unknown> } : {}),
        })
        return {
          ...replayEntry,
          ...(enriched.params ? { params: enriched.params } : {}),
        }
      })
      return {
        ...record,
        data: nextData,
      }
    },
    setNotificationHandler(handler: ((notification: { method: string; params?: unknown }) => void) | null) {
      onNotification = handler
    },
    emitNotification(notification: { method: string; params?: unknown }) {
      onNotification?.(enrichNotification(notification))
    },
    reset() {
      requests.splice(0, requests.length)
      connectUrls.splice(0, connectUrls.length)
      disconnects.splice(0, disconnects.length)
      requestImpl = () => ({})
      onNotification = null
      replaySeqCounter = 0
    },
  }
})

vi.mock('./rpcClient', () => {
  class MockRpcRequestError extends Error {
    readonly code: number
    readonly data?: unknown

    constructor(error: { code: number; message: string; data?: unknown }) {
      super(error.message)
      this.name = 'RpcRequestError'
      this.code = error.code
      this.data = error.data
    }
  }

  class MockRpcClient {
    private url = ''

    connect(
      url: string,
      handlers: {
        onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
        onNotification?: (notification: { method: string; params?: unknown }) => void
      },
    ) {
      this.url = url
      rpcMock.connectUrls.push(url)
      rpcMock.setNotificationHandler(handlers.onNotification ?? null)
      handlers.onStatus('connected')
    }

    disconnect() {
      rpcMock.disconnects.push(this.url)
    }

    async request(method: string, params?: unknown) {
      return rpcMock.callRequest(method, params)
    }

    notify() {}
  }

  return {
    RpcClient: MockRpcClient,
    RpcRequestError: MockRpcRequestError,
  }
})

describe('App thread history integration', () => {
  const SIDEBAR_WIDTH_STORAGE_KEY = 'formax:web:sidebar-size-percent'
  const RIGHT_RAIL_WIDTH_STORAGE_KEY = 'formax:web:right-rail-size-percent'

  beforeEach(() => {
    rpcMock.reset()
    delete (window as Window & { __FORMAX_SETUP_MODE__?: unknown }).__FORMAX_SETUP_MODE__
    window.sessionStorage.removeItem('formaxSetupComplete')
    window.history.replaceState(null, '', '/')
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    window.localStorage.removeItem(RIGHT_RAIL_WIDTH_STORAGE_KEY)
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
        return {
          cwd: '/repo',
          generatedAt: '2026-02-10T00:00:00.000Z',
          hasChanges: false,
          truncated: false,
          files: [],
        }
      }
      if (method === 'thread/list') {
        return {
          data: [
            {
              id: 'thread-alpha',
              cwd: '/repo',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:10.000Z',
              messageCount: 2,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 2,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        if (threadId === 'thread-alpha') {
          return {
            data: [
              { id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' },
              {
                id: 'a-tool',
                kind: 'tool',
                toolName: 'Bash',
                status: 'completed',
                summary: 'Ran ls',
                detailLines: ['$ ls', 'README.md'],
              },
            ],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta reply' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'command/dispatch') {
        const command = (params as { command?: string } | undefined)?.command
        if (command === '/todos') {
          return {
            command,
            dispatched: true,
            local: {
              stdout: 'No todos currently tracked',
            },
          }
        }
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          command,
          dispatched: true,
          turn: {
            id: `turn-${String(command ?? 'cmd').replace(/\W+/g, '-')}`,
            threadId,
            status: 'running',
          },
        }
      }
      return {}
    })
  })

  it('restores persisted sidebar and right rail widths', async () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1800 })
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '18')
    window.localStorage.setItem(RIGHT_RAIL_WIDTH_STORAGE_KEY, '31')

    try {
      render(<App />)
      await waitFor(() => {
        const leftRail = screen.getByTestId('left-rail')
        const panelSize = Number.parseFloat(leftRail.parentElement?.getAttribute('data-panel-size') ?? '0')
        expect(panelSize).toBeGreaterThan(17.5)
        expect(panelSize).toBeLessThan(18.5)
      })
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      await waitFor(() => {
        const rightPanelSize = Number.parseFloat(screen.getByTestId('right-rail').parentElement?.getAttribute('data-panel-size') ?? '0')
        expect(rightPanelSize).toBeGreaterThan(30.5)
        expect(rightPanelSize).toBeLessThan(31.5)
      })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
      window.localStorage.removeItem(RIGHT_RAIL_WIDTH_STORAGE_KEY)
    }
  })

  it('restores sidebar width after close and reopen toggle', async () => {
    render(<App />)

    const readLeftPanelSize = () =>
      Number.parseFloat(screen.getByTestId('left-rail').parentElement?.getAttribute('data-panel-size') ?? '0')

    await waitFor(() => {
      expect(readLeftPanelSize()).toBeGreaterThan(0)
    })

    const beforeToggle = readLeftPanelSize()
    fireEvent.click(screen.getByLabelText('Toggle sidebar'))

    await waitFor(() => {
      expect(readLeftPanelSize()).toBeLessThan(0.25)
    })

    fireEvent.click(screen.getByLabelText('Toggle sidebar'))

    await waitFor(() => {
      const afterToggle = readLeftPanelSize()
      expect(afterToggle).toBeGreaterThan(beforeToggle - 0.6)
      expect(afterToggle).toBeLessThan(beforeToggle + 0.6)
    })
  })

  it('toggles desktop window transparency from settings menu', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const getState = vi.fn(async () => createDesktopWindowAppearanceState(false, 1))
    const setWindowTransparency = vi.fn(async (enabled: boolean) => createDesktopWindowAppearanceState(enabled, 2))
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      windowControls: {},
      windowAppearance: {
        getState,
        setWindowTransparency,
      },
    }

    try {
      render(<App />)

      const appShell = await screen.findByTestId('app-shell')
      await waitFor(() => {
        expect(appShell.getAttribute('data-window-transparency')).toBe('off')
      })

      await clickWindowTransparencyMenuItem()

      await waitFor(() => {
        expect(appShell.getAttribute('data-window-transparency')).toBe('on')
      })
      expect(setWindowTransparency).toHaveBeenCalled()
      expect(setWindowTransparency.mock.calls.some(([enabled]) => enabled === true)).toBe(true)
      expect(getState).toHaveBeenCalledTimes(1)
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps window transparency enabled when desktop bridge confirms state', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const getState = vi.fn(async () => createDesktopWindowAppearanceState(false, 1))
    const setWindowTransparency = vi.fn(async (enabled: boolean) => createDesktopWindowAppearanceState(enabled, 2))
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      windowControls: {},
      windowAppearance: {
        getState,
        setWindowTransparency,
      },
    }

    try {
      render(<App />)

      const appShell = await screen.findByTestId('app-shell')
      await clickWindowTransparencyMenuItem()

      await waitFor(() => {
        expect(appShell.getAttribute('data-window-transparency')).toBe('on')
      })
      expect(setWindowTransparency.mock.calls.some(([enabled]) => enabled === true)).toBe(true)
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('serializes desktop transparency bridge updates during rapid toggles', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const pending: Array<() => void> = []
    const getState = vi.fn(async () => createDesktopWindowAppearanceState(false, 1))
    const setWindowTransparency = vi.fn(
      (enabled: boolean) =>
        new Promise<ReturnType<typeof createDesktopWindowAppearanceState>>((resolve) => {
          pending.push(() => resolve(createDesktopWindowAppearanceState(enabled, enabled ? 2 : 3)))
        }),
    )
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      windowControls: {},
      windowAppearance: {
        getState,
        setWindowTransparency,
      },
    }

    try {
      render(<App />)

      const appShell = await screen.findByTestId('app-shell')

      expect(getState).toHaveBeenCalledTimes(1)
      expect(setWindowTransparency).not.toHaveBeenCalled()

      await clickWindowTransparencyMenuItem()
      await waitFor(() => {
        expect(setWindowTransparency).toHaveBeenCalledTimes(1)
      })
      expect(setWindowTransparency.mock.calls[0]?.[0]).toBe(true)

      await clickWindowTransparencyMenuItem()

      // Disable call should wait until the in-flight enable call settles.
      expect(setWindowTransparency).toHaveBeenCalledTimes(1)
      expect(pending).toHaveLength(1)

      await act(async () => {
        pending.shift()?.()
      })

      await waitFor(() => {
        expect(setWindowTransparency).toHaveBeenCalledTimes(2)
      })
      expect(setWindowTransparency.mock.calls[1]?.[0]).toBe(false)
      expect(pending).toHaveLength(1)

      await act(async () => {
        pending.shift()?.()
      })

      await waitFor(() => {
        expect(appShell.getAttribute('data-window-transparency')).toBe('off')
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('reads bridge url from runtime config when provided', async () => {
    const runtimeWindow = window as Window & { __FORMAX_BRIDGE_URL__?: string }
    runtimeWindow.__FORMAX_BRIDGE_URL__ = 'ws://127.0.0.1:4777'
    try {
      render(<App />)
      await waitFor(() => {
        expect(rpcMock.connectUrls[0]).toBe('ws://127.0.0.1:4777')
      })
    } finally {
      delete runtimeWindow.__FORMAX_BRIDGE_URL__
    }
  })

  it('derives bridge url from the desktop bridge port when runtime config is absent', async () => {
    const originalDesktopBridge = window.formaxDesktop
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      bridgePort: 4888,
      windowControls: {},
    }
    try {
      render(<App />)
      await waitFor(() => {
        expect(rpcMock.connectUrls[0]).toBe('ws://localhost:4888')
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('uses setup entrypoint without starting the main app runtime for explicit setup route', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      return {}
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
      expect(screen.getByTestId('setup-compact-screen')).toBeInTheDocument()
      expect(screen.getByTestId('setup-logo')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Provider' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'OpenAI-compatible' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Anthropic-compatible' })).toBeInTheDocument()
      expect(screen.queryByText(/Bridge:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Step:/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Write setup' })).not.toBeInTheDocument()
      await waitFor(() => {
        expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
      })
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
      window.localStorage.removeItem('formaxSetupRestartRequired')
    }
  })

  it('skips the backend welcome step before showing provider choices', async () => {
    window.history.replaceState(null, '', '/setup')
    const actionRequests: unknown[] = []
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView({ step: 'welcome' })
      if (method === 'bridge/setup/session/action') {
        actionRequests.push(params)
        return { ok: true, session: createSetupSessionView({ step: 'provider' }) }
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'OpenAI-compatible' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Provider' })).toBeInTheDocument()
    expect(actionRequests).toHaveLength(1)
    expect(actionRequests[0]).toMatchObject({ action: { type: 'next' } })
  })

  it('keeps desktop setup window controls outside the centered setup block', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const minimize = vi.fn(async () => true)
    const cancel = vi.fn(async () => true)
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      windowControls: { minimize },
      setup: { complete: vi.fn(async () => true), cancel },
    }
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      return {}
    })

    try {
      render(<App />)

      expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
      expect(screen.getByTestId('setup-window-drag-region')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(minimize).toHaveBeenCalledTimes(1)
        expect(cancel).toHaveBeenCalledTimes(1)
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('uses setup entrypoint for explicit setup route without injected setup mode', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      return {}
    })

    render(<App />)

    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
    expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
  })

  it('uses setup entrypoint for explicit setup route under a base path', async () => {
    window.history.replaceState(null, '', '/app/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      return {}
    })

    render(<App />)

    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
    expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
  })

  it('preserves base-path trailing slash after setup completes', () => {
    window.history.replaceState(null, '', '/app/setup?x=1#done')

    expect(resolveRuntimeRouteAfterSetup()).toBe('/app/?x=1#done')
  })

  it('falls back to runtime on explicit setup route when status is already complete', async () => {
    window.history.replaceState(null, '', '/setup')
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      if (method === 'bridge/setup/session/create') throw new Error('should not create setup session')
      return previousRequestImpl(method, params)
    })

    render(<App />)

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/session/create')).toBe(false)
  })

  it('falls back to runtime on explicit setup route when setup mode is unavailable', async () => {
    window.history.replaceState(null, '', '/setup')
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') throw new Error('Setup mode is not enabled for this bridge.')
      return previousRequestImpl(method, params)
    })

    render(<App />)

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByTestId('setup-entrypoint')).not.toBeInTheDocument()
    expect(rpcMock.disconnects.length).toBeGreaterThan(0)
  })

  it('hands off explicit setup route to managed desktop when status is already complete', async () => {
    window.history.replaceState(null, '', '/setup')
    const complete = vi.fn(async () => true)
    const openMain = vi.fn(async () => true)
    const restoreDesktopBridge = installDesktopBridge({ setup: { complete, openMain } })
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      if (method === 'bridge/setup/session/create') throw new Error('should not create setup session')
      return {}
    })

    try {
      render(<App />)

      expect(await screen.findByTestId('setup-desktop-handoff')).toBeInTheDocument()
      await waitFor(() => {
        expect(openMain).toHaveBeenCalledTimes(1)
      })
      expect(complete).not.toHaveBeenCalled()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/session/create')).toBe(false)
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      restoreDesktopBridge()
    }
  })

  it('keeps already-configured desktop handoff retryable when opening the main route fails', async () => {
    window.history.replaceState(null, '', '/setup')
    const complete = vi.fn(async () => true)
    const openMain = vi.fn(async () => false)
    const restoreDesktopBridge = installDesktopBridge({ setup: { complete, openMain } })
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      if (method === 'bridge/setup/session/create') throw new Error('should not create setup session')
      return {}
    })

    try {
      render(<App />)

      await waitFor(() => {
        expect(openMain).toHaveBeenCalledTimes(1)
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('Desktop handoff failed')
      expect(screen.getByTestId('setup-window-drag-region')).toBeInTheDocument()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(complete).not.toHaveBeenCalled()
      expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/session/create')).toBe(false)
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      restoreDesktopBridge()
    }
  })

  it('keeps managed desktop setup-unavailable handoff retryable when opening the main route fails', async () => {
    window.history.replaceState(null, '', '/setup')
    const complete = vi.fn(async () => true)
    const openMain = vi.fn(async () => false)
    const restoreDesktopBridge = installDesktopBridge({ setup: { complete, openMain } })
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') throw new Error('Setup mode is not enabled for this bridge.')
      return {}
    })

    try {
      render(<App />)

      await waitFor(() => {
        expect(openMain).toHaveBeenCalledTimes(1)
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('Desktop handoff failed')
      expect(screen.getByTestId('setup-window-drag-region')).toBeInTheDocument()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(complete).not.toHaveBeenCalled()
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      restoreDesktopBridge()
    }
  })

  it('restarts managed desktop when setup mode is allowed and setup status requires restart', async () => {
    window.history.replaceState(null, '', '/setup')
    const originalDesktopBridge = window.formaxDesktop
    const complete = vi.fn(async () => true)
    const openMain = vi.fn(async () => true)
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      managedRuntime: true,
      windowControls: {},
      setup: { complete, cancel: vi.fn(async () => true), openMain },
    }
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true, restartRequired: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-desktop-handoff')).toBeInTheDocument()
      await waitFor(() => {
        expect(complete).toHaveBeenCalledTimes(1)
      })
      expect(openMain).not.toHaveBeenCalled()
      expect(screen.queryByTestId('setup-entrypoint')).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(rpcMock.disconnects.length).toBeGreaterThan(0)
    } finally {
      window.formaxDesktop = originalDesktopBridge
    }
  })

  it('opens runtime in browser setup mode when setup is already complete and no restart is pending', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
      expect(screen.queryByTestId('setup-restart-required')).not.toBeInTheDocument()
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
    }
  })

  it('keeps browser-only setup mode on the restart gate after this browser wrote setup', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    window.localStorage.setItem('formaxSetupRestartRequired', '1')
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true, restartRequired: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-restart-required')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Restart the web server')
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
      window.localStorage.removeItem('formaxSetupRestartRequired')
    }
  })

  it('keeps desktop dev setup mode on the restart gate after this desktop wrote setup', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    const originalDesktopBridge = window.formaxDesktop
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    window.localStorage.setItem('formaxSetupRestartRequired', 'desktop')
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      managedRuntime: false,
      windowControls: {},
      setup: { complete: vi.fn(async () => true), cancel: vi.fn(async () => true) },
    }
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true, restartRequired: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-restart-required')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Restart desktop runtime')
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
      window.localStorage.removeItem('formaxSetupRestartRequired')
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps direct setup route on the restart gate when status requires a restart', async () => {
    window.history.replaceState(null, '', '/setup')
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true, restartRequired: true }
      return {}
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-restart-required')).toBeInTheDocument()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/session/create')).toBe(false)
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
    }
  })

  it('checks setup status at a base-path desktop app root when setup mode is allowed', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    const originalDesktopBridge = window.formaxDesktop
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781/app/',
      windowControls: {},
      setup: { complete: vi.fn(async () => true), cancel: vi.fn(async () => true) },
    }
    window.history.replaceState(null, '', '/app/')
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/status')).toBe(true)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
      window.formaxDesktop = originalDesktopBridge
    }
  })

  it('checks setup status at a base-path desktop app root without a trailing slash', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    const originalDesktopBridge = window.formaxDesktop
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781/app',
      windowControls: {},
      setup: { complete: vi.fn(async () => true), cancel: vi.fn(async () => true) },
    }
    window.history.replaceState(null, '', '/app')
    const previousRequestImpl = rpcMock.getRequestImpl()
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: true }
      return previousRequestImpl(method, params)
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'bridge/setup/status')).toBe(true)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
      window.formaxDesktop = originalDesktopBridge
    }
  })

  it('opens setup at root when setup mode is allowed and setup status is incomplete', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      return {}
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
      expect(rpcMock.disconnects.length).toBeGreaterThan(0)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
    }
  })

  it('keeps the setup status gate active when setup status is unavailable at root', async () => {
    const runtimeWindow = window as Window & { __FORMAX_SETUP_MODE__?: string }
    runtimeWindow.__FORMAX_SETUP_MODE__ = 'allow'
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') throw new Error('bridge unavailable')
      return {}
    })
    try {
      render(<App />)
      expect(await screen.findByTestId('setup-status-error')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('bridge unavailable')
      expect(screen.queryByTestId('setup-entrypoint')).not.toBeInTheDocument()
      expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
    } finally {
      delete runtimeWindow.__FORMAX_SETUP_MODE__
    }
  })

  it('blocks setup field edits after the flow reaches write', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'advanced',
            model: 'sonnet-model',
            tierModels: { haiku: 'haiku-model', sonnet: 'sonnet-model', opus: 'opus-model' },
          },
        })
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.getByText('Base URL')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Model mode')).not.toBeInTheDocument()
  })

  it('locks connection fields after the setup connection test passes', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'modelMode',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: 'deepseek-chat',
            tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
          },
        })
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Model' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OpenAI-compatible' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'DeepSeek' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Model mode')).not.toBeDisabled()
    expect(screen.getByLabelText('Model')).not.toBeDisabled()
  })

  it('advances a complete credentials page to model setup with one Next click', async () => {
    window.history.replaceState(null, '', '/setup')
    let nextCount = 0
    const credentialsDraft = createCompleteSetupDraft({
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: '',
      tierModels: { haiku: '', sonnet: '', opus: '' },
    })
    const selectedModelDraft = createCompleteSetupDraft({
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-chat',
      tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
    })
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'baseUrl',
          draft: credentialsDraft,
        })
      }
      if (method === 'bridge/setup/session/action') {
        const action = (params as { action?: { type?: string } }).action
        if (action?.type === 'next') nextCount += 1
        if (nextCount === 1) {
          return {
            ok: true,
            session: createSetupSessionView({
              step: 'apiKey',
              draft: credentialsDraft,
            }),
          }
        }
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'modelMode',
            availableModels: ['deepseek-chat'],
            draft: selectedModelDraft,
          }),
        }
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Credentials' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Model' })).toBeInTheDocument()
    expect(nextCount).toBe(2)
  })

  it('stops credentials one-click advance when the setup session expires', async () => {
    window.history.replaceState(null, '', '/setup')
    let createCount = 0
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        createCount += 1
        if (createCount === 1) {
          return createSetupSessionView({
            id: 'setup-expired',
            step: 'baseUrl',
            draft: createCompleteSetupDraft({
              baseUrl: 'https://api.deepseek.com/anthropic',
              model: '',
            }),
          })
        }
        return createSetupSessionView({ id: 'setup-replacement', step: 'provider' })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: false,
          code: 'session_not_found',
          message: 'Setup session was not found or has expired.',
        }
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Credentials' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Provider' })).toBeInTheDocument()
    expect(rpcMock.requests.filter((request) => request.method === 'bridge/setup/session/action')).toHaveLength(1)
  })

  it('shows loading while a setup transition is pending', async () => {
    window.history.replaceState(null, '', '/setup')
    let resolveNext: ((value: unknown) => void) | null = null
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView({ step: 'provider' })
      if (method === 'bridge/setup/session/action') {
        return new Promise((resolve) => {
          resolveNext = resolve
        })
      }
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const primaryAction = screen.getByTestId('setup-primary-action')
    await waitFor(() => {
      expect(primaryAction).toBeDisabled()
      expect(primaryAction).toHaveAttribute('aria-busy', 'true')
    })

    await act(async () => {
      resolveNext?.({ ok: true, session: createSetupSessionView({ step: 'anthropicVendor' }) })
    })
    expect(await screen.findByRole('heading', { name: 'Vendor' })).toBeInTheDocument()
  })

  it('shows a default model selection and expands all advanced tiers', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'modelMode',
          availableModels: ['deepseek-chat', 'deepseek-reasoner'],
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: '',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        const action = (params as { action?: { type?: string; mode?: string } }).action
        if (action?.type === 'setModelMode' && action.mode === 'advanced') {
          return {
            ok: true,
            session: createSetupSessionView({
              step: 'modelMode',
              availableModels: ['deepseek-chat', 'deepseek-reasoner'],
              draft: {
                provider: 'anthropic',
                anthropicVendor: 'deepseek',
                baseUrl: 'https://api.example.com',
                apiKeyPresent: true,
                modelMode: 'advanced',
                model: 'deepseek-chat',
                tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
              },
            }),
          }
        }
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'modelMode',
            availableModels: ['deepseek-chat', 'deepseek-reasoner'],
            draft: {
              provider: 'anthropic',
              anthropicVendor: 'deepseek',
              baseUrl: 'https://api.example.com',
              apiKeyPresent: true,
              modelMode: 'quick',
              model: 'deepseek-chat',
              tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
            },
          }),
        }
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByLabelText('Model')).toHaveValue('deepseek-chat')
    fireEvent.change(screen.getByLabelText('Model mode'), { target: { value: 'advanced' } })

    expect(await screen.findByLabelText('haiku model')).toHaveValue('deepseek-chat')
    expect(screen.getByLabelText('sonnet model')).toHaveValue('deepseek-chat')
    expect(screen.getByLabelText('opus model')).toHaveValue('deepseek-chat')
  })

  it('advances advanced model setup to review with one Next click', async () => {
    window.history.replaceState(null, '', '/setup')
    let nextCount = 0
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'modelMode',
          availableModels: ['deepseek-chat', 'deepseek-reasoner'],
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'advanced',
            model: 'deepseek-chat',
            tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        const action = (params as { action?: { type?: string } }).action
        if (action?.type === 'next') nextCount += 1
        const stepByNext = [
          { step: 'model', modelTier: 'haiku' },
          { step: 'model', modelTier: 'sonnet' },
          { step: 'model', modelTier: 'opus' },
          { step: 'confirm', modelTier: null },
        ][Math.max(0, Math.min(nextCount - 1, 3))]
        return {
          ok: true,
          session: createSetupSessionView({
            ...stepByNext,
            availableModels: ['deepseek-chat', 'deepseek-reasoner'],
            draft: {
              provider: 'anthropic',
              anthropicVendor: 'deepseek',
              baseUrl: 'https://api.example.com',
              apiKeyPresent: true,
              modelMode: 'advanced',
              model: 'deepseek-chat',
              tierModels: { haiku: 'deepseek-chat', sonnet: 'deepseek-chat', opus: 'deepseek-chat' },
            },
          }),
        }
      }
      return {}
    })

    render(<App />)

    expect(await screen.findByLabelText('haiku model')).toHaveValue('deepseek-chat')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(nextCount).toBe(4)
  })

  it('clears the API key input when the setup session is replaced', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView({ id: 'setup-1', step: 'apiKey' })
      if (method === 'bridge/setup/session/action') {
        return { ok: true, session: createSetupSessionView({ id: 'setup-2', step: 'apiKey' }) }
      }
      return {}
    })

    render(<App />)

    const apiKeyInput = await screen.findByLabelText('API key') as HTMLInputElement
    fireEvent.change(apiKeyInput, { target: { value: 'secret-key' } })

    await waitFor(() => {
      expect(apiKeyInput.value).toBe('')
    })
  })

  it('keeps setup text inputs responsive while action RPCs are pending', async () => {
    window.history.replaceState(null, '', '/setup')
    const pendingActions: Array<() => void> = []
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'baseUrl',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: '',
            apiKeyPresent: false,
            modelMode: 'quick',
            model: '',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        return new Promise((resolve) => {
          pendingActions.push(() => resolve({
            ok: true,
            session: createSetupSessionView({
              step: 'baseUrl',
              draft: {
                provider: 'anthropic',
                anthropicVendor: 'deepseek',
                baseUrl: 'https://api.example.com/v1',
                apiKeyPresent: false,
                modelMode: 'quick',
                model: '',
                tierModels: { haiku: '', sonnet: '', opus: '' },
              },
            }),
          }))
        })
      }
      return {}
    })

    render(<App />)

    const baseUrlInput = await screen.findByLabelText('Base URL') as HTMLInputElement
    fireEvent.change(baseUrlInput, { target: { value: 'https://api.example.com/v1' } })

    expect(baseUrlInput.value).toBe('https://api.example.com/v1')

    await act(async () => {
      pendingActions.splice(0).forEach((resolve) => resolve())
    })
    expect(baseUrlInput.value).toBe('https://api.example.com/v1')
  })

  it('syncs setup base URL when provider actions reset it', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.deepseek.com/anthropic',
            apiKeyPresent: false,
            modelMode: 'quick',
            model: '',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'baseUrl',
            draft: {
              provider: 'openai',
              anthropicVendor: null,
              baseUrl: 'https://api.openai.com/v1',
              apiKeyPresent: false,
              modelMode: 'quick',
              model: '',
              tierModels: { haiku: '', sonnet: '', opus: '' },
            },
          }),
        }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'OpenAI-compatible' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    })
  })

  it('clears setup model input when earlier setup fields reset model selection', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'model',
          availableModels: ['old-model', 'fresh-model'],
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.deepseek.com/anthropic',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: 'old-model',
            tierModels: { haiku: 'old-model', sonnet: 'old-model', opus: 'old-model' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'model',
            availableModels: ['fresh-model'],
            draft: {
              provider: 'anthropic',
              anthropicVendor: 'deepseek',
              baseUrl: 'https://proxy.example.com/anthropic',
              apiKeyPresent: true,
              modelMode: 'advanced',
              model: 'fresh-model',
              tierModels: { haiku: 'fresh-model', sonnet: 'fresh-model', opus: 'fresh-model' },
            },
          }),
        }
      }
      return {}
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('old-model')
    })
    fireEvent.change(screen.getByLabelText('Model mode'), { target: { value: 'advanced' } })

    await waitFor(() => {
      expect(screen.getByLabelText('haiku model')).toHaveValue('fresh-model')
      expect(screen.getByLabelText('sonnet model')).toHaveValue('fresh-model')
      expect(screen.getByLabelText('opus model')).toHaveValue('fresh-model')
    })
  })

  it('syncs setup base URL input after server normalization', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'baseUrl',
          draft: {
            provider: 'openai',
            anthropicVendor: null,
            baseUrl: '',
            apiKeyPresent: false,
            modelMode: 'quick',
            model: '',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'baseUrl',
            draft: {
              provider: 'openai',
              anthropicVendor: null,
              baseUrl: 'https://proxy.example.com/v1',
              apiKeyPresent: false,
              modelMode: 'quick',
              model: '',
              tierModels: { haiku: '', sonnet: '', opus: '' },
            },
          }),
        }
      }
      return {}
    })

    render(<App />)

    const baseUrlInput = await screen.findByLabelText('Base URL')
    fireEvent.change(baseUrlInput, { target: { value: 'https://proxy.example.com/v1///' } })

    await waitFor(() => {
      expect(baseUrlInput).toHaveValue('https://proxy.example.com/v1')
    })
  })

  it('blocks duplicate setup step transitions while an action RPC is pending', async () => {
    window.history.replaceState(null, '', '/setup')
    const pendingActions: Array<() => void> = []
    const actionRequests: unknown[] = []
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      if (method === 'bridge/setup/session/action') {
        actionRequests.push(params)
        return new Promise((resolve) => {
          pendingActions.push(() => resolve({ ok: true, session: createSetupSessionView({ step: 'apiKey' }) }))
        })
      }
      return {}
    })

    render(<App />)

    const nextButton = await screen.findByRole('button', { name: 'Next' })
    await act(async () => {
      fireEvent.click(nextButton)
      fireEvent.click(nextButton)
    })

    await waitFor(() => expect(actionRequests).toHaveLength(1))
    expect(nextButton).toBeDisabled()

    await act(async () => {
      pendingActions.splice(0).forEach((resolve) => resolve())
    })
    await waitFor(() => expect(nextButton).not.toBeDisabled())
  })

  it('surfaces setup action RPC failures', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') return createSetupSessionView()
      if (method === 'bridge/setup/session/action') throw new Error('action transport failed')
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('action transport failed')
  })

  it('recreates setup sessions after session_not_found action results', async () => {
    window.history.replaceState(null, '', '/setup')
    let createCount = 0
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        createCount += 1
        return createSetupSessionView({ id: `setup-${createCount}` })
      }
      if (method === 'bridge/setup/session/action') {
        return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
      }
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Setup session was not found')
    await waitFor(() => {
      expect(rpcMock.requests.filter((request) => request.method === 'bridge/setup/session/create')).toHaveLength(2)
    })
  })

  it('surfaces setup commit RPC failures', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: createCompleteSetupDraft(),
        })
      }
      if (method === 'bridge/setup/session/commit') throw new Error('commit transport failed')
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('commit transport failed')
  })

  it('commits a complete review page with one Save click', async () => {
    window.history.replaceState(null, '', '/setup')
    const completeDraft = createCompleteSetupDraft()
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'confirm',
          draft: completeDraft,
        })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: true,
          session: createSetupSessionView({
            step: 'write',
            draft: completeDraft,
          }),
        }
      }
      if (method === 'bridge/setup/session/commit') return { ok: true }
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Restart the web server')
    expect(
      rpcMock.requests
        .filter((request) =>
          request.method === 'bridge/setup/session/action' ||
          request.method === 'bridge/setup/session/commit'
        )
        .map((request) => request.method)
    ).toEqual(['bridge/setup/session/action', 'bridge/setup/session/commit'])
    expect(
      (rpcMock.requests.find((request) => request.method === 'bridge/setup/session/action')?.params as {
        action?: unknown
      }).action
    ).toEqual({ type: 'next' })
  })

  it('does not commit the review page when the confirm transition expires', async () => {
    window.history.replaceState(null, '', '/setup')
    let createCount = 0
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        createCount += 1
        if (createCount === 1) {
          return createSetupSessionView({
            id: 'setup-expired',
            step: 'confirm',
            draft: createCompleteSetupDraft(),
          })
        }
        return createSetupSessionView({ id: 'setup-replacement', step: 'provider' })
      }
      if (method === 'bridge/setup/session/action') {
        return {
          ok: false,
          code: 'session_not_found',
          message: 'Setup session was not found or has expired.',
        }
      }
      if (method === 'bridge/setup/session/commit') throw new Error('should not commit after expired transition')
      return {}
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('heading', { name: 'Provider' })).toBeInTheDocument()
    expect(rpcMock.requests.filter((request) => request.method === 'bridge/setup/session/commit')).toHaveLength(0)
  })

  it('shows loading while setup commit is pending', async () => {
    window.history.replaceState(null, '', '/setup')
    let resolveCommit: ((value: unknown) => void) | null = null
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: createCompleteSetupDraft(),
        })
      }
      if (method === 'bridge/setup/session/commit') {
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      }
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const primaryAction = screen.getByTestId('setup-primary-action')
    await waitFor(() => {
      expect(primaryAction).toBeDisabled()
      expect(primaryAction).toHaveAttribute('aria-busy', 'true')
    })

    await act(async () => {
      resolveCommit?.({ ok: true })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Restart the web server')
  })

  it('keeps browser setup on the setup page after a successful write', async () => {
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: 'sonnet-model',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/commit') return { ok: true }
      return {}
    })

    render(<App />)
    expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Restart the web server')
    expect(window.localStorage.getItem('formaxSetupRestartRequired')).toBe('browser')
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(rpcMock.requests.some((request) => request.method === 'initialize')).toBe(false)
  })

  it('retries desktop setup completion without reusing a committed setup session', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const complete = vi.fn(async () => false)
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      managedRuntime: true,
      windowControls: {},
      setup: { complete, cancel: vi.fn(async () => true) },
    }
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: 'sonnet-model',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/commit') return { ok: true }
      return {}
    })

    try {
      render(<App />)
      expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Retry desktop restart')

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(complete).toHaveBeenCalledTimes(2)
      })
      expect(rpcMock.requests.filter((request) => request.method === 'bridge/setup/session/commit')).toHaveLength(1)
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps desktop dev setup on the setup page after writing setup', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const complete = vi.fn(async () => true)
    window.localStorage.removeItem('formaxSetupRestartRequired')
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      managedRuntime: false,
      windowControls: {},
      setup: { complete, cancel: vi.fn(async () => true) },
    }
    window.history.replaceState(null, '', '/setup')
    rpcMock.setRequestImpl((method) => {
      if (method === 'bridge/setup/status') return { ok: true, complete: false }
      if (method === 'bridge/setup/session/create') {
        return createSetupSessionView({
          step: 'write',
          draft: {
            provider: 'anthropic',
            anthropicVendor: 'deepseek',
            baseUrl: 'https://api.example.com',
            apiKeyPresent: true,
            modelMode: 'quick',
            model: 'sonnet-model',
            tierModels: { haiku: '', sonnet: '', opus: '' },
          },
        })
      }
      if (method === 'bridge/setup/session/commit') return { ok: true }
      return {}
    })

    try {
      render(<App />)
      expect(await screen.findByTestId('setup-entrypoint')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Restart desktop runtime')
      expect(window.localStorage.getItem('formaxSetupRestartRequired')).toBe('desktop')
      expect(complete).not.toHaveBeenCalled()
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps assistant text ordered before later tool rows in the same turn', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/started',
        params: {
          eventId: 'turn-order:1',
          traceId: 'trace-order',
          seq: 1,
          turn: { id: 'turn-order', threadId: 'thread-alpha', status: 'running' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-order:2',
          traceId: 'trace-order',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-order',
          event: { type: 'assistant_delta', text: 'assistant-before-tool' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-order:3',
          traceId: 'trace-order',
          seq: 3,
          threadId: 'thread-alpha',
          turnId: 'turn-order',
          event: {
            type: 'tool_start',
            id: 'tool-order-1',
            name: 'Write',
            input: { file_path: 'snake-game.html' },
          },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-order:4',
          traceId: 'trace-order',
          seq: 4,
          threadId: 'thread-alpha',
          turnId: 'turn-order',
          event: {
            type: 'tool_end',
            id: 'tool-order-1',
            result: { content: 'Wrote snake-game.html', is_error: false },
          },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/completed',
        params: {
          eventId: 'turn-order:5',
          traceId: 'trace-order',
          seq: 5,
          turn: { id: 'turn-order', threadId: 'thread-alpha', status: 'completed' },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('assistant-before-tool')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Worked with 1 tool/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edited 1 file/i })).toHaveAttribute('aria-expanded', 'false')
    })

    fireEvent.click(screen.getByRole('button', { name: /edited 1 file/i }))

    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getAllByText('snake-game.html').length).toBeGreaterThan(0)

    const centerText = screen.getByTestId('center-pane').textContent ?? ''
    const snakePathIndex = centerText.indexOf('snake-game.html')
    expect(snakePathIndex).toBeGreaterThanOrEqual(0)
    expect(centerText.indexOf('assistant-before-tool')).toBeLessThan(snakePathIndex)
  })

  it('keeps assistant segments split when tool rows are interleaved in the same turn', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/started',
        params: {
          eventId: 'turn-split:1',
          traceId: 'trace-split',
          seq: 1,
          turn: { id: 'turn-split', threadId: 'thread-alpha', status: 'running' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-split:2',
          traceId: 'trace-split',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-split',
          event: { type: 'assistant_delta', text: 'assistant-before' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-split:3',
          traceId: 'trace-split',
          seq: 3,
          threadId: 'thread-alpha',
          turnId: 'turn-split',
          event: {
            type: 'tool_start',
            id: 'tool-split-1',
            name: 'Write',
            input: { file_path: 'snake-game.html' },
          },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-split:4',
          traceId: 'trace-split',
          seq: 4,
          threadId: 'thread-alpha',
          turnId: 'turn-split',
          event: { type: 'assistant_delta', text: 'assistant-after' },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('assistant-before')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Working with 1 tool/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edited 1 file/i })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('assistant-after')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /edited 1 file/i }))

    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getAllByText('snake-game.html').length).toBeGreaterThan(0)

    const centerText = screen.getByTestId('center-pane').textContent ?? ''
    const snakePathIndex = centerText.indexOf('snake-game.html')
    expect(snakePathIndex).toBeGreaterThanOrEqual(0)
    expect(centerText.indexOf('assistant-before')).toBeLessThan(snakePathIndex)
    expect(snakePathIndex).toBeLessThan(centerText.indexOf('assistant-after'))
  })

  it('deduplicates repeated eventId notifications', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/started',
        params: {
          eventId: 'turn-1:1',
          traceId: 'trace-1',
          seq: 1,
          turn: { id: 'turn-1', threadId: 'thread-alpha', status: 'running' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-1:2',
          traceId: 'trace-1',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-1',
          event: { type: 'assistant_delta', text: 'dedupe-check' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-1:2',
          traceId: 'trace-1',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-1',
          event: { type: 'assistant_delta', text: 'dedupe-check' },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getAllByText('dedupe-check')).toHaveLength(1)
    })
  })

  it('drops out-of-order seq notifications for the same trace', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/started',
        params: {
          eventId: 'turn-2:1',
          traceId: 'trace-2',
          seq: 1,
          turn: { id: 'turn-2', threadId: 'thread-alpha', status: 'running' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-2:3',
          traceId: 'trace-2',
          seq: 3,
          threadId: 'thread-alpha',
          turnId: 'turn-2',
          event: { type: 'assistant_delta', text: 'newer-delta' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-2:2',
          traceId: 'trace-2',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-2',
          event: { type: 'assistant_delta', text: 'older-delta' },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('newer-delta')).toBeInTheDocument()
    })
    expect(screen.queryByText('older-delta')).not.toBeInTheDocument()
  })

  it('loads stale inputs from thread/resume without rendering pending list in right rail', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
        return {
          cwd: '/repo',
          generatedAt: '2026-02-10T00:00:00.000Z',
          hasChanges: false,
          truncated: false,
          files: [],
        }
      }
      if (method === 'thread/list') {
        return {
          data: [
            {
              id: 'thread-alpha',
              cwd: '/repo',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:10.000Z',
              messageCount: 2,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        if (threadId === 'thread-alpha') {
          return {
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'thread/resume') {
        return {
          thread: {
            id: 'thread-alpha',
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [
            {
              inputId: 'stale-1',
              threadId: 'thread-alpha',
              turnId: 'turn-9',
              toolUseId: 'approval-9',
              kind: 'approval',
              status: 'expired',
              createdAt: '2026-02-10T00:00:01.000Z',
              expiresAt: '2026-02-10T00:05:01.000Z',
              resolvedAt: '2026-02-10T00:05:01.000Z',
              reason: 'server_restart',
            },
          ],
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))

    await screen.findByText('alpha reply')
    expect(await screen.findByTestId('worktree-diff-pane')).toBeInTheDocument()
    expect(screen.getByText('No unstaged changes')).toBeInTheDocument()
    expect(screen.queryByText(/Recovered \(Expired\/Resolved\)/i)).not.toBeInTheDocument()
    expect(screen.queryByText('approval-9')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/resume' &&
            (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
        ),
      ).toBe(true)
    })
  })

  it('does not leak buffered deltas into another thread after switching', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/started',
        params: {
          eventId: 'turn-3:1',
          traceId: 'trace-3',
          seq: 1,
          turn: { id: 'turn-3', threadId: 'thread-alpha', status: 'running' },
        },
      })
      rpcMock.emitNotification({
        method: 'turn/event',
        params: {
          eventId: 'turn-3:2',
          traceId: 'trace-3',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-3',
          event: { type: 'assistant_delta', text: 'buffered-cross-thread-delta' },
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 90))
    })

    expect(screen.queryByText('buffered-cross-thread-delta')).not.toBeInTheDocument()
  })
})
