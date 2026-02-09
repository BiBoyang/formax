import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const rpcMock = vi.hoisted(() => {
  let requestImpl: (method: string, params: unknown) => unknown = () => ({})
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
    reset() {
      requests.splice(0, requests.length)
      requestImpl = () => ({})
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
      },
    ) {
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
})
