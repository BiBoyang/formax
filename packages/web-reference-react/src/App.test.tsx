import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  clickWindowTransparencyMenuItem,
  createDesktopWindowAppearanceState,
  setComposerMode,
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

  it('keeps mode routing consistent across turn/start and command/dispatch', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.change(input, { target: { value: 'hello normal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.mode === 'normal' &&
            (entry.params as any)?.input?.text === 'hello normal',
        ),
      ).toBe(true)
    })

    await setComposerMode('Plan mode')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'hello plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.mode === 'plan' &&
            (entry.params as any)?.input?.text === 'hello plan',
        ),
      ).toBe(true)
    })

    await setComposerMode('Edit automatically')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'hello auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.mode === 'acceptEdits' &&
            (entry.params as any)?.input?.text === 'hello auto',
        ),
      ).toBe(true)
    })

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/init' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.mode === 'acceptEdits' &&
            (entry.params as any)?.command === '/init',
        ),
      ).toBe(true)
    })

    await setComposerMode('Plan mode')
    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), {
      target: { value: '/compact summarize the conversation' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.mode === 'plan' &&
            (entry.params as any)?.command === '/compact summarize the conversation',
        ),
      ).toBe(true)
    })

    const settledRequestCount = rpcMock.requests.length
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(rpcMock.requests.length).toBe(settledRequestCount)

    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'turn/start' &&
          ((entry.params as any)?.input?.text === '/init' ||
            (entry.params as any)?.input?.text === '/compact summarize the conversation'),
      ),
    ).toBe(false)
  })

  it('applies turn/modeChanged from server to subsequent turn requests', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/modeChanged',
        params: {
          threadId: 'thread-alpha',
          turnId: 'turn-1',
          mode: 'plan',
        },
      })
    })

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'follow server mode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.mode === 'plan' &&
            (entry.params as any)?.input?.text === 'follow server mode',
        ),
      ).toBe(true)
    })
  })

  it('resets mode to normal when switching to a thread with no replay state', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await setComposerMode('Plan mode')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'mode should reset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-beta' &&
            (entry.params as any)?.mode === 'normal' &&
            (entry.params as any)?.input?.text === 'mode should reset',
        ),
      ).toBe(true)
    })
  })

  it('keeps user-selected mode for a thread before first turn starts', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    await setComposerMode('Plan mode')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), {
      target: { value: 'thread mode draft should persist' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-beta' &&
            (entry.params as any)?.mode === 'plan' &&
            (entry.params as any)?.input?.text === 'thread mode draft should persist',
        ),
      ).toBe(true)
    })
  })

  it('does not leak previous thread mode while next thread replay is still hydrating', async () => {
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
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-beta') {
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta reply' }],
                  nextCursor: null,
                }),
              60,
            ),
          )
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-beta' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return {
          data: [],
          nextCursor: 0,
          latestCursor: 0,
          hasGap: false,
          state: null,
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-beta-fast',
            threadId: (params as { threadId?: string } | undefined)?.threadId ?? 'thread-beta',
            status: 'running',
          },
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await setComposerMode('Plan mode')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'fast switch send' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-beta' &&
            (entry.params as any)?.mode === 'normal' &&
            (entry.params as any)?.input?.text === 'fast switch send',
        ),
      ).toBe(true)
    })
  })

  it('hydrates mode from thread replay state snapshot', async () => {
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
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        return {
          data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
          nextCursor: null,
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        const after = (params as { after?: number } | undefined)?.after
        return {
          data:
            after === 0
              ? [
                  {
                    replaySeq: 8,
                    method: 'turn/event',
                    params: {
                      threadId: 'thread-alpha',
                      turnId: 'turn-4',
                      event: { type: 'assistant_delta', text: 'alpha reply' },
                    },
                  },
                ]
              : [],
          nextCursor: 8,
          latestCursor: 8,
          hasGap: false,
          state: {
            mode: 'acceptEdits',
            activeTurnId: null,
            lastTurnId: 'turn-4',
            lastTurnStatus: 'completed',
            pendingInputCount: 0,
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-next',
            threadId: 'thread-alpha',
            status: 'running',
          },
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/replay' && (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
        ),
      ).toBe(true)
    })

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: 'replay mode send' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.mode === 'acceptEdits' &&
            (entry.params as any)?.input?.text === 'replay mode send',
        ),
      ).toBe(true)
    })
  })

  it('hydrates pending approval inputs from thread replay state snapshot', async () => {
    rpcMock.setRequestImpl((method) => {
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
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        return {
          data: [],
          nextCursor: null,
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return {
          data: [],
          nextCursor: 12,
          latestCursor: 12,
          hasGap: false,
          state: {
            mode: 'normal',
            activeTurnId: 'turn-4',
            lastTurnId: 'turn-3',
            lastTurnStatus: 'running',
            pendingInputCount: 1,
            pendingInputs: [
              {
                inputId: 'input-1',
                threadId: 'thread-alpha',
                turnId: 'turn-4',
                toolUseId: 'tool-approve-1',
                kind: 'approval',
                status: 'pending',
                createdAt: '2026-02-10T00:00:01.000Z',
                expiresAt: '2026-02-10T00:05:01.000Z',
                payload: {
                  toolName: 'Bash',
                  action: { command: 'rm -rf a.js' },
                },
              },
            ],
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))

    expect(await screen.findByTestId('approval-submit-panel-input-1')).toBeInTheDocument()
    expect(await screen.findByText('Do you want to run this command?')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Ask for follow-up changes')).not.toBeInTheDocument()
  })

  it('includes active thread cwd on turn/start and command/dispatch requests', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: '/repo-alpha',
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
              cwd: '/repo-alpha',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:40.000Z',
              messageCount: 2,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo-beta ',
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
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
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
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-beta' }, staleInputs: [] }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-cwd',
            threadId: (params as { threadId?: string } | undefined)?.threadId ?? 'thread-beta',
            status: 'running',
          },
        }
      }
      if (method === 'command/dispatch') {
        return {
          command: (params as { command?: string } | undefined)?.command,
          dispatched: true,
          turn: {
            id: 'turn-cwd-command',
            threadId: (params as { threadId?: string } | undefined)?.threadId ?? 'thread-beta',
            status: 'running',
          },
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.change(input, { target: { value: 'hello cwd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.threadId === 'thread-beta' &&
            (entry.params as any)?.cwd === '/repo-beta ',
        ),
      ).toBe(true)
    })

    fireEvent.change(input, { target: { value: '/init' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.threadId === 'thread-beta' &&
            (entry.params as any)?.cwd === '/repo-beta ' &&
            (entry.params as any)?.command === '/init',
        ),
      ).toBe(true)
    })
  })

  it('starts new thread with selected working directory cwd', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: '/repo-alpha',
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
              cwd: '/repo-alpha',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:40.000Z',
              messageCount: 2,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo-beta',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 2,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
        }
      }
      if (method === 'thread/start') {
        const cwd = (params as { cwd?: string } | undefined)?.cwd ?? '/repo-alpha'
        return {
          thread: {
            id: 'thread-new',
            cwd,
            createdAt: '2026-02-10T00:01:00.000Z',
            updatedAt: '2026-02-10T00:01:00.000Z',
          },
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
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta reply' }],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-new') {
          return { data: [], nextCursor: null }
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-new' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)
    await screen.findByRole('button', { name: /Alpha Session/i })

    fireEvent.click(screen.getByTitle('/repo-beta'))
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) => entry.method === 'thread/start' && (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
        ),
      ).toBe(true)
    })
  })

  it('hides folders provided by thread/list hiddenGroupCwds', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: '/repo-alpha',
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
              cwd: '/repo-alpha',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:40.000Z',
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo-beta',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 1,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
          hiddenGroupCwds: ['/repo-beta'],
        }
      }
      if (method === 'thread/messages') {
        return { data: [], nextCursor: null }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)
    await screen.findByRole('button', { name: /Alpha Session/i })

    expect(screen.getByTitle('/repo-alpha')).toBeInTheDocument()
    expect(screen.queryByTitle('/repo-beta')).not.toBeInTheDocument()
  })

  it('persists folder hide marker through thread/group/hide rpc', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: '/repo-alpha',
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
              cwd: '/repo-alpha',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:40.000Z',
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo-beta',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 1,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
          hiddenGroupCwds: [],
        }
      }
      if (method === 'thread/group/hide') {
        return {
          hiddenGroupCwds: [(params as { cwd?: string } | undefined)?.cwd ?? ''],
        }
      }
      if (method === 'thread/messages') {
        return { data: [], nextCursor: null }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)
    await screen.findByRole('button', { name: /Alpha Session/i })
    expect(screen.getByTitle('/repo-beta')).toBeInTheDocument()

    const folderActionsButton = screen.getByRole('button', { name: 'Folder actions for repo-beta' })
    fireEvent.mouseDown(folderActionsButton, { button: 0 })
    fireEvent.pointerDown(folderActionsButton, { button: 0, ctrlKey: false })
    fireEvent.click(folderActionsButton)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove session folder' }), { detail: 1, button: 0 })

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/group/hide' &&
            (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
        ),
      ).toBe(true)
    })

    await waitFor(() => {
      expect(screen.queryByTitle('/repo-beta')).not.toBeInTheDocument()
    })
  })

  it('uses command/dispatch for /init and /todos only', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.change(input, { target: { value: '/init' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.command === '/init',
        ),
      ).toBe(true)
    })

    expect(rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/init')).toBe(
      false,
    )

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.command === '/todos',
        ),
      ).toBe(true)
    })
    expect(rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/todos')).toBe(
      false,
    )
    expect(await screen.findByText('No todos currently tracked')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/permissions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(
      await screen.findByText('Web reference does not support /permissions yet. Please use TUI for this command.'),
    ).toBeInTheDocument()
    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'turn/start' &&
          (entry.params as any)?.threadId === 'thread-alpha' &&
          (entry.params as any)?.input?.text === '/permissions',
      ),
    ).toBe(false)
    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'command/dispatch' &&
          (entry.params as any)?.threadId === 'thread-alpha' &&
          (entry.params as any)?.command === '/permissions',
      ),
    ).toBe(false)
  })

  it('handles /clear locally by creating a new thread', async () => {
    let created = 0
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
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        if (threadId === 'thread-alpha') {
          return { data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }], nextCursor: null }
        }
        if (threadId === 'thread-new') {
          return { data: [], nextCursor: null }
        }
      }
      if (method === 'thread/start') {
        created += 1
        return {
          thread: {
            id: 'thread-new',
            cwd: '/repo',
            createdAt: '2026-02-10T00:01:00.000Z',
            updatedAt: '2026-02-10T00:01:00.000Z',
          },
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-new' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/clear' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(created).toBe(1)
      expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(true)
    })
    expect(
      rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/clear'),
    ).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/clear'),
    ).toBe(false)
  })

  it('shows usage for /clear with arguments and does not send RPC turn command', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/clear extra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect((await screen.findAllByText('Usage: /clear')).length).toBeGreaterThan(0)
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/clear extra'),
    ).toBe(false)
    expect(
      rpcMock.requests.some(
        (entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/clear extra',
      ),
    ).toBe(false)
  })

  it('routes /compact via command/dispatch and does not call turn/start directly', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/compact' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/compact',
        ),
      ).toBe(true)
    })
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/compact'),
    ).toBe(false)
    expect(
      rpcMock.requests.some(
        (entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/compact',
      ),
    ).toBe(true)
  })

  it('shows unsupported hint for /help and does not send RPC turn command', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/help' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Web reference does not support /help yet. Please use TUI for this command.')).toBeInTheDocument()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/help'),
    ).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/help'),
    ).toBe(false)
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

  it('re-baselines replay cursor after hasGap so next replay uses refreshed cursor', async () => {
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
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
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
      if (method === 'thread/resume') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          thread: {
            id: threadId,
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        const after = (params as { after?: number } | undefined)?.after
        if (threadId !== 'thread-alpha') {
          return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
        }
        if (after === 0) {
          return {
            data: [
              {
                replaySeq: 10,
                method: 'turn/event',
                params: {
                  threadId: 'thread-alpha',
                  turnId: 'turn-init',
                  event: { type: 'assistant_delta', text: 'alpha replay' },
                },
              },
            ],
            nextCursor: 10,
            latestCursor: 10,
            hasGap: false,
          }
        }
        if (after == null) return { data: [], nextCursor: 30, latestCursor: 30, hasGap: false }
        if (after === 10) {
          return {
            data: [
              {
                replaySeq: 20,
                method: 'turn/event',
                params: {
                  threadId: 'thread-alpha',
                  turnId: 'turn-gap',
                  event: { type: 'assistant_delta', text: 'gap-tail' },
                },
              },
            ],
            nextCursor: 20,
            latestCursor: 30,
            hasGap: true,
          }
        }
        if (after === 30) {
          return {
            data: [
              {
                replaySeq: 31,
                method: 'turn/event',
                params: {
                  threadId: 'thread-alpha',
                  turnId: 'turn-sync',
                  event: { type: 'assistant_delta', text: 'sync-tail' },
                },
              },
            ],
            nextCursor: 31,
            latestCursor: 31,
            hasGap: false,
          }
        }
        return { data: [], nextCursor: after, latestCursor: after, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha replay')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha replay')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('sync-tail')

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/replay' &&
            (entry.params as { threadId?: string; after?: number } | undefined)?.threadId === 'thread-alpha' &&
            (entry.params as { threadId?: string; after?: number } | undefined)?.after === 30,
        ),
      ).toBe(true)
    })

    const alphaHistoryCalls = rpcMock.requests.filter(
      (entry) =>
        entry.method === 'thread/messages' &&
        (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
    )
    expect(alphaHistoryCalls).toHaveLength(0)
  })

  it('fast-rebases hasGap for history-source thread without reloading history again', async () => {
    let alphaReplayCalls = 0
    let alphaHistoryCalls = 0
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
              messageCount: 1,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        if (threadId === 'thread-alpha') {
          alphaHistoryCalls += 1
          return {
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha history once' }],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta fallback' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'thread/resume') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          thread: {
            id: threadId,
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string; after?: number } | undefined)?.threadId
        const after = (params as { threadId?: string; after?: number } | undefined)?.after
        if (threadId === 'thread-beta') {
          return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
        }
        if (threadId !== 'thread-alpha') {
          return { data: [], nextCursor: after ?? 0, latestCursor: after ?? 0, hasGap: false }
        }

        if (after === 0) {
          alphaReplayCalls += 1
          if (alphaReplayCalls === 1) {
            return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
          }
          if (alphaReplayCalls === 2) {
            return {
              data: [],
              nextCursor: 20,
              latestCursor: 30,
              hasGap: true,
            }
          }
        }
        if (after === 30) {
          return {
            data: [
              {
                replaySeq: 31,
                method: 'turn/event',
                params: {
                  threadId: 'thread-alpha',
                  turnId: 'turn-sync',
                  event: { type: 'assistant_delta', text: 'alpha replay after gap' },
                },
              },
            ],
            nextCursor: 31,
            latestCursor: 31,
            hasGap: false,
          }
        }
        return { data: [], nextCursor: after ?? 0, latestCursor: after ?? 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha history once')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta fallback')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha history once')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta fallback')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha replay after gap')

    expect(alphaHistoryCalls).toBe(1)
  })

  it('uses replay projection snapshot on hasGap without falling back to thread/messages for that thread', async () => {
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
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta reply' }],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-alpha') {
          return {
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha history fallback' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'thread/resume') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          thread: {
            id: threadId,
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        const after = (params as { after?: number } | undefined)?.after
        if (threadId === 'thread-alpha') {
          if (after === 0) {
            return {
              data: [
                {
                  replaySeq: 10,
                  method: 'turn/event',
                  params: {
                    threadId: 'thread-alpha',
                    turnId: 'turn-init',
                    event: { type: 'assistant_delta', text: 'alpha replay start' },
                  },
                },
              ],
              nextCursor: 10,
              latestCursor: 10,
              hasGap: false,
              state: {
                mode: 'normal',
                activeTurnId: null,
                lastTurnId: 'turn-init',
                lastTurnStatus: 'completed',
                pendingInputCount: 0,
                pendingInputs: [],
                projection: null,
                toolNameByUseId: {},
                updatedAt: '2026-02-10T00:00:10.000Z',
              },
            }
          }
          if (after === 10) {
            return {
              data: [
                {
                  replaySeq: 21,
                  method: 'turn/event',
                  params: {
                    threadId: 'thread-alpha',
                    turnId: 'turn-gap',
                    event: { type: 'assistant_delta', text: 'tail unreachable without snapshot' },
                  },
                },
              ],
              nextCursor: 21,
              latestCursor: 30,
              hasGap: true,
              state: {
                mode: 'normal',
                activeTurnId: null,
                lastTurnId: 'turn-sync',
                lastTurnStatus: 'completed',
                pendingInputCount: 0,
                pendingInputs: [],
                projection: {
                  segments: [
                    {
                      id: 'turn-sync:assistant:30',
                      kind: 'assistant',
                      turnId: 'turn-sync',
                      text: 'projection rebuilt',
                    },
                  ],
                  lastReplaySeq: 30,
                  toolNameByUseId: {},
                  openAssistantSegmentIdByTurn: {},
                  openThinkingSegmentIdByTurn: {},
                },
                toolNameByUseId: {},
                updatedAt: '2026-02-10T00:00:30.000Z',
              },
            }
          }
          return { data: [], nextCursor: after ?? 0, latestCursor: after ?? 0, hasGap: false }
        }
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha replay start')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('projection rebuilt')

    await waitFor(() => {
      const alphaHistoryCalls = rpcMock.requests.filter(
        (entry) =>
          entry.method === 'thread/messages' &&
          (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
      )
      expect(alphaHistoryCalls).toHaveLength(0)
    })
  })

  it('recovers hasGap from baseline replay snapshot without calling thread/messages', async () => {
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
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta reply' }],
            nextCursor: null,
          }
        }
        if (threadId === 'thread-alpha') {
          return {
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha history fallback' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'thread/resume') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          thread: {
            id: threadId,
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        const after = (params as { after?: number } | undefined)?.after
        if (threadId === 'thread-alpha') {
          if (after === 0) {
            return {
              data: [
                {
                  replaySeq: 10,
                  method: 'turn/event',
                  params: {
                    threadId: 'thread-alpha',
                    turnId: 'turn-init',
                    event: { type: 'assistant_delta', text: 'alpha replay start' },
                  },
                },
              ],
              nextCursor: 10,
              latestCursor: 10,
              hasGap: false,
              state: {
                mode: 'normal',
                activeTurnId: null,
                lastTurnId: 'turn-init',
                lastTurnStatus: 'completed',
                pendingInputCount: 0,
                pendingInputs: [],
                projection: null,
                toolNameByUseId: {},
                updatedAt: '2026-02-10T00:00:10.000Z',
              },
            }
          }
          if (after === 10) {
            return {
              data: [],
              nextCursor: 21,
              latestCursor: 30,
              hasGap: true,
              state: {
                mode: 'normal',
                activeTurnId: null,
                lastTurnId: 'turn-sync',
                lastTurnStatus: 'completed',
                pendingInputCount: 0,
                pendingInputs: [],
                projection: null,
                toolNameByUseId: {},
                updatedAt: '2026-02-10T00:00:30.000Z',
              },
            }
          }
          if (after === undefined) {
            return {
              data: [],
              nextCursor: 30,
              latestCursor: 30,
              hasGap: false,
              state: {
                mode: 'normal',
                activeTurnId: null,
                lastTurnId: 'turn-sync',
                lastTurnStatus: 'completed',
                pendingInputCount: 0,
                pendingInputs: [],
                projection: {
                  segments: [
                    {
                      id: 'turn-sync:assistant:30',
                      kind: 'assistant',
                      turnId: 'turn-sync',
                      text: 'baseline replay projection',
                    },
                  ],
                  lastReplaySeq: 30,
                  toolNameByUseId: {},
                  openAssistantSegmentIdByTurn: {},
                  openThinkingSegmentIdByTurn: {},
                },
                toolNameByUseId: {},
                updatedAt: '2026-02-10T00:00:30.000Z',
              },
            }
          }
          return { data: [], nextCursor: after ?? 0, latestCursor: after ?? 0, hasGap: false }
        }
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha replay start')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('baseline replay projection')

    await waitFor(() => {
      const alphaHistoryCalls = rpcMock.requests.filter(
        (entry) =>
          entry.method === 'thread/messages' &&
          (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
      )
      expect(alphaHistoryCalls).toHaveLength(0)
    })
  })

  it('ignores stale hasGap projection hydration after switching to another thread', async () => {
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
              messageCount: 1,
              lastUserPrompt: 'alpha',
              label: 'Alpha Session',
            },
            {
              id: 'thread-beta',
              cwd: '/repo',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 1,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        return { data: [], nextCursor: null }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        const after = (params as { after?: number } | undefined)?.after
        if (threadId === 'thread-alpha') {
          if (after === 0) {
            return new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    data: [],
                    nextCursor: 30,
                    latestCursor: 30,
                    hasGap: true,
                    state: {
                      mode: 'normal',
                      activeTurnId: null,
                      lastTurnId: 'turn-alpha',
                      lastTurnStatus: 'completed',
                      pendingInputCount: 0,
                      pendingInputs: [],
                      projection: {
                        segments: [
                          {
                            id: 'turn-alpha:assistant:30',
                            kind: 'assistant',
                            turnId: 'turn-alpha',
                            text: 'alpha stale projection',
                          },
                        ],
                        lastReplaySeq: 30,
                        toolNameByUseId: {},
                        openAssistantSegmentIdByTurn: {},
                        openThinkingSegmentIdByTurn: {},
                      },
                      toolNameByUseId: {},
                      updatedAt: '2026-02-10T00:00:30.000Z',
                    },
                  }),
                70,
              ),
            )
          }
          return { data: [], nextCursor: after ?? 0, latestCursor: after ?? 0, hasGap: false }
        }
        if (threadId === 'thread-beta') {
          return {
            data:
              after === 0
                ? [
                    {
                      replaySeq: 8,
                      method: 'turn/event',
                      params: {
                        threadId: 'thread-beta',
                        turnId: 'turn-beta',
                        event: { type: 'assistant_delta', text: 'beta replay result' },
                      },
                    },
                  ]
                : [],
            nextCursor: 8,
            latestCursor: 8,
            hasGap: false,
            state: {
              mode: 'normal',
              activeTurnId: null,
              lastTurnId: 'turn-beta',
              lastTurnStatus: 'completed',
              pendingInputCount: 0,
              pendingInputs: [],
              projection: null,
              toolNameByUseId: {},
              updatedAt: '2026-02-10T00:00:08.000Z',
            },
          }
        }
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Beta Session/i }))

    await screen.findByText('beta replay result')
    await waitFor(
      () => {
        expect(screen.queryByText('alpha stale projection')).not.toBeInTheDocument()
      },
      { timeout: 500 },
    )
  })

  it('replays thread events first on thread switch and skips history when replay has data', async () => {
    let historyRequested = false
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
        historyRequested = true
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
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        return {
          data: [
            {
              replaySeq: 1,
              method: 'turn/event',
              params: {
                threadId: 'thread-alpha',
                turnId: 'turn-1',
                event: { type: 'assistant_delta', text: 'replay-first transcript' },
              },
            },
          ],
          nextCursor: 1,
          latestCursor: 1,
          hasGap: false,
        }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))

    expect(await screen.findByText('replay-first transcript')).toBeInTheDocument()
    expect(historyRequested).toBe(false)
  })

  it('disables history pagination after a thread recovers from history fallback to replay', async () => {
    let alphaReplayAttempt = 0
    let pagedHistoryRequested = false
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
              messageCount: 1,
              lastUserPrompt: 'beta',
              label: 'Beta Session',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        const threadId = (params as { threadId?: string; cursor?: string } | undefined)?.threadId
        const cursor = (params as { threadId?: string; cursor?: string } | undefined)?.cursor
        if (threadId === 'thread-alpha') {
          if (cursor) {
            pagedHistoryRequested = true
            return {
              data: [{ id: 'a-older', kind: 'message', role: 'assistant', text: 'older alpha page' }],
              nextCursor: null,
            }
          }
          return {
            data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha from history fallback' }],
            nextCursor: 'cursor-alpha-older',
          }
        }
        if (threadId === 'thread-beta') {
          return {
            data: [{ id: 'b-1', kind: 'message', role: 'assistant', text: 'beta fallback' }],
            nextCursor: null,
          }
        }
      }
      if (method === 'thread/resume') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? 'thread-alpha'
        return {
          thread: {
            id: threadId,
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:10.000Z',
          },
          staleInputs: [],
        }
      }
      if (method === 'thread/replay') {
        const threadId = (params as { threadId?: string } | undefined)?.threadId
        if (threadId === 'thread-beta') {
          return {
            data: [
              {
                replaySeq: 1,
                method: 'turn/event',
                params: {
                  threadId: 'thread-beta',
                  turnId: 'turn-beta',
                  event: { type: 'assistant_delta', text: 'beta replay canonical' },
                },
              },
            ],
            nextCursor: 1,
            latestCursor: 1,
            hasGap: false,
          }
        }
        if (threadId === 'thread-alpha') {
          alphaReplayAttempt += 1
          if (alphaReplayAttempt === 1) {
            return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
          }
          return {
            data: [
              {
                replaySeq: 12,
                method: 'turn/event',
                params: {
                  threadId: 'thread-alpha',
                  turnId: 'turn-alpha',
                  event: { type: 'assistant_delta', text: 'alpha replay canonical' },
                },
              },
            ],
            nextCursor: 12,
            latestCursor: 12,
            hasGap: false,
          }
        }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    expect(await screen.findByText('alpha from history fallback')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    expect(await screen.findByText('beta replay canonical')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    expect(await screen.findByText('alpha replay canonical')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument()
    expect(pagedHistoryRequested).toBe(false)
  })

  it('opens ask dock on inputRequested, supports dismiss, and restores composer after resolved', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/inputRequested',
        params: {
          eventId: 'turn-ask:1',
          traceId: 'trace-ask',
          seq: 1,
          threadId: 'thread-alpha',
          turnId: 'turn-ask',
          input: {
            inputId: 'input-ask-1',
            threadId: 'thread-alpha',
            turnId: 'turn-ask',
            toolUseId: 'ask-tool-1',
            kind: 'ask_user_question',
            status: 'pending',
            createdAt: '2026-02-10T00:00:01.000Z',
            expiresAt: '2030-02-10T00:05:01.000Z',
            payload: {
              questions: [
                {
                  header: 'Environment',
                  question: 'Which OS do you use most?',
                  fieldId: 'os',
                  options: [
                    { label: 'macOS', description: 'Apple device' },
                    { label: 'Windows', description: 'PC device' },
                  ],
                  multiSelect: false,
                },
              ],
            },
          },
        },
      })
    })

    expect(screen.getByTestId('input-approval-dock-host')).toBeInTheDocument()
    expect(screen.getByLabelText('Question index')).toHaveTextContent('1 of 1')
    expect(screen.getByText('question:pending')).toBeInTheDocument()
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-locked')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByTestId('ask-dock-collapsed')).toBeInTheDocument()
    expect(screen.getByTestId('composer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/inputResolved',
        params: {
          eventId: 'turn-ask:2',
          traceId: 'trace-ask',
          seq: 2,
          threadId: 'thread-alpha',
          turnId: 'turn-ask',
          input: {
            inputId: 'input-ask-1',
            threadId: 'thread-alpha',
            turnId: 'turn-ask',
            toolUseId: 'ask-tool-1',
            kind: 'ask_user_question',
            status: 'submitted',
            createdAt: '2026-02-10T00:00:01.000Z',
            expiresAt: '2030-02-10T00:05:01.000Z',
            resolvedAt: '2026-02-10T00:00:20.000Z',
          },
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('input-approval-dock-host')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('composer')).toBeInTheDocument()
  })

  it('keeps approval dock non-modal and hides it after switching to a session without pending input', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/inputRequested',
        params: {
          eventId: 'turn-approval-switch:1',
          traceId: 'trace-approval-switch',
          seq: 1,
          threadId: 'thread-alpha',
          turnId: 'turn-approval-switch',
          input: {
            inputId: 'input-approval-switch-1',
            threadId: 'thread-alpha',
            turnId: 'turn-approval-switch',
            toolUseId: 'approval-tool-switch-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-10T00:00:01.000Z',
            expiresAt: '2030-02-10T00:05:01.000Z',
            payload: {
              toolName: 'Bash',
              action: { kind: 'bash.exec', command: 'echo hello' },
              effectiveDecision: { decision: 'ask' },
            },
          },
        },
      })
    })

    expect(screen.getByTestId('input-approval-dock-host')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))

    expect(await screen.findByText('beta reply')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('input-approval-dock-host')).not.toBeInTheDocument()
    })
  })

  it('submits bash remember approval directly without scope step', async () => {
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
      if (method === 'turn/input/submit') {
        return { accepted: true, status: 'accepted' }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/inputRequested',
        params: {
          eventId: 'turn-approval:1',
          traceId: 'trace-approval',
          seq: 1,
          threadId: 'thread-alpha',
          turnId: 'turn-approval',
          input: {
            inputId: 'input-approval-1',
            threadId: 'thread-alpha',
            turnId: 'turn-approval',
            toolUseId: 'approval-tool-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-10T00:00:01.000Z',
            expiresAt: '2030-02-10T00:05:01.000Z',
            payload: {
              toolName: 'Bash',
              action: { kind: 'bash.exec', command: 'rm -rf a.js && ls -l a.js' },
              effectiveDecision: { decision: 'ask' },
            },
          },
        },
      })
    })

    expect(screen.queryByLabelText('Question index')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(screen.getByText('approval:pending')).toBeInTheDocument()
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('1 of 1')

    fireEvent.click(screen.getByRole('button', { name: /2\. Approve and remember/i }))
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/input/submit' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.inputId ===
              'input-approval-1' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.answers?.decision ===
              'approve_remember' &&
            !Object.prototype.hasOwnProperty.call(
              (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.answers ?? {},
              'scope',
            ),
        ),
      ).toBe(true)
    })
  })

  it('submits scope in second step when approval remember requires policy scope', async () => {
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
      if (method === 'turn/input/submit') {
        return { accepted: true, status: 'accepted' }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/inputRequested',
        params: {
          eventId: 'turn-approval-scope:1',
          traceId: 'trace-approval-scope',
          seq: 1,
          threadId: 'thread-alpha',
          turnId: 'turn-approval-scope',
          input: {
            inputId: 'input-approval-scope-1',
            threadId: 'thread-alpha',
            turnId: 'turn-approval-scope',
            toolUseId: 'approval-tool-scope-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-10T00:00:01.000Z',
            expiresAt: '2030-02-10T00:05:01.000Z',
            payload: {
              toolName: 'Read',
              action: { kind: 'fs.read', path: '/tmp/outside.txt' },
              effectiveDecision: { decision: 'ask' },
            },
          },
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /2\. Approve and remember/i }))
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('1 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('2 of 2')

    fireEvent.click(screen.getByRole('button', { name: /2\. Project/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/input/submit' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.inputId ===
              'input-approval-scope-1' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.answers?.decision ===
              'approve_remember' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.answers?.scope ===
              'project',
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
