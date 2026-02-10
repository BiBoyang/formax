import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const rpcMock = vi.hoisted(() => {
  let requestImpl: (method: string, params: unknown) => unknown = () => ({})
  let onNotification: ((notification: { method: string; params?: unknown }) => void) | null = null
  const requests: Array<{ method: string; params: unknown }> = []

  return {
    requests,
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
      _url: string,
      handlers: {
        onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
        onNotification?: (notification: { method: string; params?: unknown }) => void
      },
    ) {
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
  beforeEach(() => {
    rpcMock.reset()
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
    expect(screen.getByText('Ran ls')).toBeInTheDocument()

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

  it('sends selected mode in turn/start params', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.change(input, { target: { value: 'hello mode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'turn/start' &&
            (entry.params as any)?.mode === 'normal' &&
            (entry.params as any)?.input?.text === 'hello mode',
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

  it('shows unsupported hint for /compact and does not send RPC turn command', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/compact' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(
      await screen.findByText('Web reference does not support /compact yet. Please use TUI for this command.'),
    ).toBeInTheDocument()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/compact'),
    ).toBe(false)
    expect(
      rpcMock.requests.some((entry) => entry.method === 'command/dispatch' && (entry.params as any)?.command === '/compact'),
    ).toBe(false)
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

  it('loads stale inputs from thread/resume and renders recovered section', async () => {
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

    expect(await screen.findByText(/Recovered \(Expired\/Resolved\)/i)).toBeInTheDocument()
    expect(screen.getByText('approval-9')).toBeInTheDocument()

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
    let replayBaselineCount = 0
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
        if (after == null) {
          replayBaselineCount += 1
          const cursor = replayBaselineCount === 1 ? 10 : 30
          return { data: [], nextCursor: cursor, latestCursor: cursor, hasGap: false }
        }
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
    await screen.findByText('alpha reply')

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))
    await screen.findByText('beta reply')

    fireEvent.click(screen.getByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

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

  it('loads thread history before replaying thread events on thread switch', async () => {
    let alphaHistoryResolved = false
    let replayRequestedBeforeHistory = false
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
          return new Promise((resolve) => {
            setTimeout(() => {
              alphaHistoryResolved = true
              resolve({
                data: [{ id: 'a-1', kind: 'message', role: 'assistant', text: 'alpha reply' }],
                nextCursor: null,
              })
            }, 30)
          })
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
        if (!alphaHistoryResolved) replayRequestedBeforeHistory = true
        return {
          data: [
            {
              replaySeq: 1,
              method: 'turn/event',
              params: {
                threadId: 'thread-alpha',
                turnId: 'turn-1',
                event: { type: 'assistant_delta', text: 'replay after history' },
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

    expect(await screen.findByText('alpha reply')).toBeInTheDocument()
    expect(await screen.findByText('replay after history')).toBeInTheDocument()
    expect(replayRequestedBeforeHistory).toBe(false)
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
