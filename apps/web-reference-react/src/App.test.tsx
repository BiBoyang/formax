import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const rpcMock = vi.hoisted(() => {
  let requestImpl: (method: string, params: unknown) => unknown = () => ({})
  let onNotification: ((notification: { method: string; params?: unknown }) => void) | null = null
  const requests: Array<{ method: string; params: unknown }> = []
  const connectUrls: string[] = []

  return {
    requests,
    connectUrls,
    setRequestImpl(impl: (method: string, params: unknown) => unknown) {
      requestImpl = impl
    },
    callRequest(method: string, params: unknown) {
      requests.push({ method, params })
      return requestImpl(method, params)
    },
    setNotificationHandler(handler: ((notification: { method: string; params?: unknown }) => void) | null) {
      onNotification = handler
    },
    emitNotification(notification: { method: string; params?: unknown }) {
      onNotification?.(notification)
    },
    reset() {
      requests.splice(0, requests.length)
      connectUrls.splice(0, connectUrls.length)
      requestImpl = () => ({})
      onNotification = null
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
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '320')
    window.localStorage.setItem(RIGHT_RAIL_WIDTH_STORAGE_KEY, '460')

    try {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByTestId('left-rail')).toHaveStyle('width: 320px')
      })
      expect(screen.getByTestId('right-rail')).toHaveStyle('width: 460px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
      window.localStorage.removeItem(RIGHT_RAIL_WIDTH_STORAGE_KEY)
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

    fireEvent.click(screen.getAllByLabelText('Thread actions')[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename thread' }))
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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))

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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Auto edit' }))

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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))
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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))

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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))

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

    fireEvent.click(screen.getByLabelText('Execution mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))

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

    fireEvent.click(screen.getByRole('button', { name: /repo-beta/ }))
    fireEvent.click(screen.getByRole('button', { name: /New thread/i }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) => entry.method === 'thread/start' && (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
        ),
      ).toBe(true)
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

    expect(await screen.findByText('/compact')).toBeInTheDocument()
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
      expect(screen.getByText('Write snake-game.html')).toBeInTheDocument()
    })

    const centerText = screen.getByTestId('center-pane').textContent ?? ''
    expect(centerText.indexOf('assistant-before-tool')).toBeLessThan(centerText.indexOf('Write snake-game.html'))
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
      expect(screen.getByText('Write snake-game.html')).toBeInTheDocument()
      expect(screen.getByText('assistant-after')).toBeInTheDocument()
    })

    const centerText = screen.getByTestId('center-pane').textContent ?? ''
    expect(centerText.indexOf('assistant-before')).toBeLessThan(centerText.indexOf('Write snake-game.html'))
    expect(centerText.indexOf('Write snake-game.html')).toBeLessThan(centerText.indexOf('assistant-after'))
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
    expect(screen.getByText('question:submitted')).toBeInTheDocument()
    expect(screen.getByTestId('composer')).toBeInTheDocument()
  })

  it('renders approval dock without pager and submits through turn/input/submit', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /3\. No/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/input/submit' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.inputId ===
              'input-approval-1' &&
            (entry.params as { inputId?: string; answers?: Record<string, string> } | undefined)?.answers?.decision ===
              'reject',
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
