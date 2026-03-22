import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

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

beforeEach(() => {
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
    setRequestImpl(impl: (method: string, params: unknown) => unknown) {
      requestImpl = impl
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
    connect(
      url: string,
      handlers: {
        onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
        onNotification?: (notification: { method: string; params?: unknown }) => void
      },
    ) {
      rpcMock.connectUrls.push(url)
      rpcMock.setNotificationHandler(handlers.onNotification ?? null)
      handlers.onStatus('connected')
    }

    disconnect() {}

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
  const SIDEBAR_WIDTH_STORAGE_KEY = 'formax:web:sidebar-width'
  const RIGHT_RAIL_WIDTH_STORAGE_KEY = 'formax:web:right-rail-width'

  beforeEach(() => {
    rpcMock.reset()
    window.history.replaceState(null, '', '/')
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    window.localStorage.removeItem(RIGHT_RAIL_WIDTH_STORAGE_KEY)
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
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
      const rightPanelSize = Number.parseFloat(screen.getByTestId('right-rail').parentElement?.getAttribute('data-panel-size') ?? '0')
      expect(rightPanelSize).toBeGreaterThan(30.5)
      expect(rightPanelSize).toBeLessThan(31.5)
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
      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getAllByText('snake-game.html').length).toBeGreaterThan(0)
    })

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
      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getAllByText('snake-game.html').length).toBeGreaterThan(0)
      expect(screen.getByText('assistant-after')).toBeInTheDocument()
    })

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
      if (method === 'bridge/readDiff') {
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
    expect(screen.getByText('Uncommitted worktree changes')).toBeInTheDocument()
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
