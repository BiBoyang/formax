import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

vi.mock('../app/core/userSettings', async () => {
  const actual = await vi.importActual<typeof import('../app/core/userSettings')>('../app/core/userSettings')
  return {
    ...actual,
    DEFAULT_USER_SETTINGS: { ...actual.DEFAULT_USER_SETTINGS, language: 'en-US' },
  }
})

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

  it('loads selected thread history and renders tool history blocks', async () => {
    render(<App />)

    const alphaButton = await screen.findByRole('button', { name: /Alpha Session/i })
    fireEvent.click(alphaButton)

    expect(await screen.findByText('alpha reply')).toBeInTheDocument()
    expect(screen.getByText(/^Bash$/)).toBeInTheDocument()

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/messages' &&
            (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-alpha',
        ),
      ).toBe(true)
    })
  })

  it('hydrates active thread from url query param', async () => {
    window.history.replaceState(null, '', '/?thread=thread-beta')
    render(<App />)

    expect(await screen.findByText('beta reply')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/messages' &&
            (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-beta',
        ),
      ).toBe(true)
    })
  })

  it('updates url query when switching threads', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-alpha')
    })

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-beta')
    })
  })

  it('keeps active session unchanged when selecting a session folder', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: (params as { cwd?: string } | undefined)?.cwd ?? '/repo-alpha',
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
              updatedAt: '2026-02-10T00:00:10.000Z',
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
        return { thread: { id: (params as any)?.threadId ?? 'thread-alpha' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-alpha')
    })

    fireEvent.click(screen.getByTitle('/repo-beta'))

    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-alpha')
    })
    expect(screen.getByText('alpha reply')).toBeInTheDocument()
    expect(screen.queryByText('beta reply')).not.toBeInTheDocument()
    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'thread/messages' &&
          (entry.params as { threadId?: string } | undefined)?.threadId === 'thread-beta',
      ),
    ).toBe(false)
    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'bridge/readDiff' &&
          (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
      ),
    ).toBe(false)
  })

  it('refreshes right diff with selected thread cwd', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/readDiff') {
        return {
          cwd: (params as { cwd?: string } | undefined)?.cwd ?? '/repo-default',
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
              id: 'thread-a',
              cwd: '/repo-a',
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:10.000Z',
              messageCount: 1,
              lastUserPrompt: 'a',
              label: 'Thread A',
            },
            {
              id: 'thread-b',
              cwd: '/repo-b',
              createdAt: '2026-02-10T00:00:20.000Z',
              updatedAt: '2026-02-10T00:00:30.000Z',
              messageCount: 1,
              lastUserPrompt: 'b',
              label: 'Thread B',
            },
          ],
        }
      }
      if (method === 'thread/messages') {
        return { data: [], nextCursor: null }
      }
      return {}
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Thread A/i }))
    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'bridge/readDiff' &&
            (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-a',
        ),
      ).toBe(true)
    })

    fireEvent.click(await screen.findByRole('button', { name: /Thread B/i }))
    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'bridge/readDiff' &&
            (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-b',
        ),
      ).toBe(true)
    })
  })

  it('switches thread transcript to the newly selected thread history', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    expect(await screen.findByText('alpha reply')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    expect(await screen.findByText('beta reply')).toBeInTheDocument()
    expect(screen.queryByText('alpha reply')).not.toBeInTheDocument()
  })

  it('renames thread from thread action menu and refreshes list', async () => {
    let currentLabel = 'Alpha Session'
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
              label: currentLabel,
            },
          ],
        }
      }
      if (method === 'thread/rename') {
        currentLabel = String((params as { label?: string } | undefined)?.label ?? currentLabel)
        return {
          thread: {
            id: 'thread-alpha',
            cwd: '/repo',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:01:00.000Z',
            messageCount: 1,
            lastUserPrompt: 'alpha',
            label: currentLabel,
          },
        }
      }
      return {}
    })

    render(<App />)
    await screen.findByRole('button', { name: /Alpha Session/i })

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Alpha Session/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename thread' }), { detail: 1, button: 0 })
    fireEvent.change(await screen.findByPlaceholderText('Thread title'), {
      target: { value: 'Renamed Session' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'thread/rename' &&
            (entry.params as { threadId?: string; label?: string } | undefined)?.threadId === 'thread-alpha' &&
            (entry.params as { threadId?: string; label?: string } | undefined)?.label === 'Renamed Session',
        ),
      ).toBe(true)
    })

    expect(await screen.findByRole('button', { name: /Renamed Session/i })).toBeInTheDocument()
  })

  it('updates header title after turn completion refreshes thread list and hides thread id subtitle', async () => {
    let listVersion = 0
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
              updatedAt: listVersion ? '2026-02-10T00:01:10.000Z' : '2026-02-10T00:00:10.000Z',
              messageCount: 2,
              lastUserPrompt: 'hello there',
              label: listVersion ? 'Auto Generated Title' : null,
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
      return {}
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /hello there/i }))
    const header = await screen.findByRole('banner')
    expect(within(header).getByText('hello there')).toBeInTheDocument()
    expect(screen.queryByText('thread thread-a')).not.toBeInTheDocument()

    listVersion = 1
    await act(async () => {
      rpcMock.emitNotification({
        method: 'turn/completed',
        params: {
          turn: { id: 'turn-1', threadId: 'thread-alpha', status: 'completed' },
        },
      })
    })

    await waitFor(() => {
      expect(within(header).getByText('Auto Generated Title')).toBeInTheDocument()
    })
    expect(screen.queryByText('thread thread-a')).not.toBeInTheDocument()
  })

})
