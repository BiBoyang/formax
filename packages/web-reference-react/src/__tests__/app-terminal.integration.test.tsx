import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { createDesktopTerminalHarness } from '../test/appTestHarness'

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

const xtermMock = vi.hoisted(() => {
  type MockTerminalOptions = {
    theme?: Record<string, string>
  }
  const instances: MockTerminal[] = []

  class MockTerminal {
    cols = 120
    rows = 36
    options: MockTerminalOptions
    private host: HTMLElement | null = null
    private output = ''
    private dataListeners = new Set<(data: string) => void>()

    constructor(options: MockTerminalOptions = {}) {
      this.options = { ...options }
      instances.push(this)
    }

    loadAddon() {}

    open(host: HTMLElement) {
      this.host = host
      this.render()
    }

    onData(listener: (data: string) => void) {
      this.dataListeners.add(listener)
      return {
        dispose: () => {
          this.dataListeners.delete(listener)
        },
      }
    }

    write(data: string) {
      this.output += data
      this.render()
    }

    reset() {
      this.output = ''
      this.render()
    }

    focus() {}

    dispose() {
      this.dataListeners.clear()
      this.host = null
      this.output = ''
    }

    private render() {
      if (!this.host) return
      this.host.textContent = this.output
    }
  }

  class MockFitAddon {
    fit() {}
  }

  const reset = () => {
    instances.length = 0
  }

  return { MockTerminal, MockFitAddon, instances, reset }
})

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: xtermMock.MockTerminal,
  }
})

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: xtermMock.MockFitAddon,
  }
})

vi.mock('../rpcClient', () => {
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
    xtermMock.reset()
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
  it('disables terminal toggle when no active thread is selected', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      const toggleButton = await screen.findByRole('button', { name: 'Toggle terminal' })
      expect(toggleButton).toBeDisabled()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('creates terminal session on first toggle and shows pane', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))

      const toggleButton = await screen.findByRole('button', { name: 'Toggle terminal' })
      expect(toggleButton).toBeEnabled()
      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(terminalHarness.ensureSession).toHaveBeenCalled()
      })
      expect(terminalHarness.ensureSession.mock.calls[0]?.[0]).toBe('thread-alpha')
      expect(await screen.findByTestId('terminal-pane')).toBeInTheDocument()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('reuses a single xterm instance across terminal toggles and thread switches', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')
      await waitFor(() => {
        expect(xtermMock.instances).toHaveLength(1)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')
      expect(xtermMock.instances).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')
      await waitFor(() => {
        expect(terminalHarness.getSnapshot).toHaveBeenCalledWith('thread-beta')
      })
      expect(xtermMock.instances).toHaveLength(1)
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('reads terminal theme colors from css tokens', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge
    const root = document.documentElement
    root.style.setProperty('--vscode-terminal-background', 'rgb(12, 34, 56)')
    root.style.setProperty('--vscode-terminal-foreground', 'rgb(240, 240, 245)')
    root.style.setProperty('--terminal-cursor', 'rgb(111, 122, 133)')

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')

      await waitFor(() => {
        const terminalInstance =
          xtermMock.instances[xtermMock.instances.length - 1]
        expect(terminalInstance).toBeDefined()
        expect(terminalInstance?.options.theme?.background).toBe('rgb(12, 34, 56)')
        expect(terminalInstance?.options.theme?.foreground).toBe('rgb(240, 240, 245)')
        expect(terminalInstance?.options.theme?.cursor).toBe('rgb(111, 122, 133)')
      })
    } finally {
      root.style.removeProperty('--vscode-terminal-background')
      root.style.removeProperty('--vscode-terminal-foreground')
      root.style.removeProperty('--terminal-cursor')
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('restores terminal output when switching back to thread with existing shell', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness({
      'thread-alpha': {
        exists: true,
        output: '$ ls\nREADME.md\n',
      },
    })
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      const terminalPane = await screen.findByTestId('terminal-pane')
      await waitFor(() => {
        expect(within(terminalPane).getByText(/README\.md/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
      const restoredTerminalPane = await screen.findByTestId('terminal-pane')
      await waitFor(() => {
        expect(within(restoredTerminalPane).getByText(/README\.md/)).toBeInTheDocument()
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps terminal hidden after manual close when switching away and back', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')

      fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
      fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
      })
      expect(terminalHarness.destroySession).not.toHaveBeenCalled()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('destroys terminal session when thread is archived', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')

      await act(async () => {
        rpcMock.emitNotification({
          method: 'thread/archived',
          params: { threadId: 'thread-alpha', opId: 'archive-terminal-test' },
        })
      })

      await waitFor(() => {
        expect(terminalHarness.destroySession).toHaveBeenCalledWith('thread-alpha')
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps terminal pane visible after shell exit event', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      await screen.findByTestId('terminal-pane')

      await act(async () => {
        terminalHarness.emit({
          type: 'exit',
          threadId: 'thread-alpha',
          exitCode: 0,
        })
      })

      const pane = await screen.findByTestId('terminal-pane')
      expect(pane).toBeInTheDocument()
      expect(within(pane).getByText(/Shell exited \(code 0\)/)).toBeInTheDocument()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('keeps live output when snapshot resolves after data event', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    const pendingSnapshotResolves: Array<
      (snapshot: { exists: boolean; output: string; exitCode?: number | null; dataSeq?: number }) => void
    > = []
    terminalHarness.getSnapshot.mockImplementation(
      async (_threadId: string) =>
        new Promise((resolve) => {
          pendingSnapshotResolves.push(resolve)
        }),
    )
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle terminal' }))
      const pane = await screen.findByTestId('terminal-pane')

      await act(async () => {
        terminalHarness.emit({
          type: 'data',
          threadId: 'thread-alpha',
          chunk: 'live-output\n',
          dataSeq: 1,
        })
      })

      await act(async () => {
        for (const resolve of pendingSnapshotResolves.splice(0, pendingSnapshotResolves.length)) {
          resolve({ exists: true, output: 'history\nlive-output\n', dataSeq: 1 })
        }
      })

      await waitFor(() => {
        expect(within(pane).getByText(/live-output/)).toBeInTheDocument()
        expect(within(pane).getByText(/history/)).toBeInTheDocument()
      })
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

  it('toggles terminal with Ctrl+J and ignores shortcut in composer input', async () => {
    const originalDesktopBridge = window.formaxDesktop
    const terminalHarness = createDesktopTerminalHarness()
    window.formaxDesktop = terminalHarness.desktopBridge

    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))

      const composer = screen.getByPlaceholderText('Ask for follow-up changes')
      composer.focus()
      fireEvent.keyDown(composer, { key: 'j', ctrlKey: true })
      expect(terminalHarness.ensureSession).not.toHaveBeenCalled()
      expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
      await waitFor(() => {
        expect(terminalHarness.ensureSession).toHaveBeenCalledWith('thread-alpha', expect.any(String))
      })
      expect(await screen.findByTestId('terminal-pane')).toBeInTheDocument()
    } finally {
      if (originalDesktopBridge) {
        window.formaxDesktop = originalDesktopBridge
      } else {
        delete window.formaxDesktop
      }
    }
  })

})
