import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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


})
