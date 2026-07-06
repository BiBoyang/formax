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
import { setComposerMode } from '../test/appTestHarness'

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
      if (method === 'config/runtimeDefaults/read') {
        return {
          effective: { modelTier: 'sonnet', thinkingMode: true, thinkingEffort: 'medium' },
          profile: { provider: 'anthropic' },
          capabilities: { thinkingEffort: { provider: 'anthropic' } },
        }
      }
      if (method === 'config/runtimeDefaults/patch') {
        return {
          effective: { modelTier: 'sonnet', thinkingMode: true, thinkingEffort: 'medium', ...(params as Record<string, unknown>) },
          profile: { provider: 'anthropic' },
          capabilities: { thinkingEffort: { provider: 'anthropic' } },
        }
      }
      if (method === 'thread/runtimeState/read') {
        return {
          threadId: inferThreadId((params as Record<string, unknown> | null) ?? {}) ?? 'thread-alpha',
          state: null,
          effectiveProfile: { provider: 'anthropic' },
        }
      }
      if (method === 'thread/runtimeState/patch') {
        const patch = params && typeof params === 'object' ? (params as Record<string, unknown>).patch : null
        const preferences = patch && typeof patch === 'object'
          ? (patch as { preferences?: unknown }).preferences
          : undefined
        return {
          threadId: inferThreadId((params as Record<string, unknown> | null) ?? {}) ?? 'thread-alpha',
          state: { preferences },
          effectiveProfile: { provider: 'anthropic' },
        }
      }
      const raw = requestImpl(method, params)
      if ((method === 'turn/start' || method === 'command/dispatch') && raw && typeof raw === 'object') {
        const turn = (raw as { turn?: unknown }).turn
        if (turn && typeof turn === 'object') {
          const turnRecord = turn as Record<string, unknown>
          const turnId = typeof turnRecord.id === 'string' && turnRecord.id.trim() ? turnRecord.id : ''
          const threadId = typeof turnRecord.threadId === 'string' && turnRecord.threadId.trim()
            ? turnRecord.threadId
            : inferThreadId((params as Record<string, unknown> | null) ?? {})
          if (turnId && threadId && turnRecord.status === 'running') {
            setTimeout(() => {
              onNotification?.(enrichNotification({
                method: 'turn/completed',
                params: {
                  threadId,
                  turn: { id: turnId, threadId, status: 'completed' },
                },
              }))
            }, 0)
          }
        }
      }
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
  const LEFT_RAIL_OPEN_BY_CWD_STORAGE_KEY = 'formax.web.leftRail.openByCwd.v1'

  beforeEach(() => {
    rpcMock.reset()
    window.history.replaceState(null, '', '/')
    window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    window.localStorage.removeItem(RIGHT_RAIL_WIDTH_STORAGE_KEY)
    window.localStorage.removeItem(LEFT_RAIL_OPEN_BY_CWD_STORAGE_KEY)
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
        if (command === '/context') {
          return {
            command,
            dispatched: true,
            local: {
              stdout: 'Context diagnostics\n- Mode: normal\n- Tool result blocks: 1',
              diagnostics: {
                kind: 'formax.context_diagnostics',
                schemaVersion: 1,
                mode: 'normal',
                model: 'claude-3-5-sonnet-latest',
                latestCompactBoundary: null,
                snapshot: {
                  totalTokens: 100,
                  systemTokens: 20,
                  historyTokens: 80,
                  toolResultTokens: 30,
                  otherHistoryTokens: 50,
                  messageCount: 4,
                  userMessageCount: 2,
                  assistantMessageCount: 2,
                  toolResultBlockCount: 1,
                  microCompactedToolResultCount: 0,
                  toolResultCountsByToolName: [{ toolName: 'Read', count: 1 }],
                  microCompactedCountsByToolName: [],
                  contextWindowTokens: 200000,
                  effectiveLimitTokens: 180000,
                  autoCompactLimitTokens: 170000,
                  baselineTokens: 1000,
                  percentRemaining: 99,
                  remainingToEffectiveLimit: 179900,
                  remainingToAutoCompactLimit: 169900,
                  shouldAutoCompact: false,
                  topSnapshotContributors: [{ label: 'system', tokens: 20 }],
                },
                nextTurnFixed: {
                  fixedGroups: [],
                  microCompactImpact: {
                    compactedBlocks: 0,
                    compactedToolNames: [],
                    estimatedTokensSaved: 0,
                    keptRecentBlocks: 0,
                  },
                  projectedHistoryTokens: 80,
                  projectedHistoryDeltaTokens: 0,
                  fixedTokens: 0,
                  totalTokens: 80,
                  remainingToEffectiveLimit: 179920,
                  remainingToAutoCompactLimit: 169920,
                  shouldAutoCompact: false,
                  topAssembledContributors: [{ label: 'history', tokens: 80 }],
                },
                notes: [],
              },
            },
          }
        }
        if (command === '/context --json') {
          return {
            command,
            dispatched: true,
            local: {
              stdout: '{\n  "kind": "formax.context_diagnostics",\n  "schemaVersion": 1\n}',
              diagnostics: {
                kind: 'formax.context_diagnostics',
                schemaVersion: 1,
                mode: 'normal',
                model: 'claude-3-5-sonnet-latest',
                latestCompactBoundary: null,
                snapshot: {
                  totalTokens: 100,
                  systemTokens: 20,
                  historyTokens: 80,
                  toolResultTokens: 30,
                  otherHistoryTokens: 50,
                  messageCount: 4,
                  userMessageCount: 2,
                  assistantMessageCount: 2,
                  toolResultBlockCount: 1,
                  microCompactedToolResultCount: 0,
                  toolResultCountsByToolName: [{ toolName: 'Read', count: 1 }],
                  microCompactedCountsByToolName: [],
                  contextWindowTokens: 200000,
                  effectiveLimitTokens: 180000,
                  autoCompactLimitTokens: 170000,
                  baselineTokens: 1000,
                  percentRemaining: 99,
                  remainingToEffectiveLimit: 179900,
                  remainingToAutoCompactLimit: 169900,
                  shouldAutoCompact: false,
                  topSnapshotContributors: [{ label: 'system', tokens: 20 }],
                },
                nextTurnFixed: {
                  fixedGroups: [],
                  microCompactImpact: {
                    compactedBlocks: 0,
                    compactedToolNames: [],
                    estimatedTokensSaved: 0,
                    keptRecentBlocks: 0,
                  },
                  projectedHistoryTokens: 80,
                  projectedHistoryDeltaTokens: 0,
                  fixedTokens: 0,
                  totalTokens: 80,
                  remainingToEffectiveLimit: 179920,
                  remainingToAutoCompactLimit: 169920,
                  shouldAutoCompact: false,
                  topAssembledContributors: [{ label: 'history', tokens: 80 }],
                },
                notes: [],
              },
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

  it('keeps mode routing consistent across turn/start and command/dispatch', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'turn/start') {
        const record = (params && typeof params === 'object' ? params : {}) as {
          threadId?: string
          input?: { text?: string }
        }
        return {
          turn: {
            id: `turn-${String(record.input?.text ?? 'message').replace(/\W+/g, '-')}`,
            threadId: record.threadId ?? 'thread-alpha',
            status: 'running',
          },
        }
      }
      return {}
    })

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

    await setComposerMode('Plan')

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

    await setComposerMode('Auto')

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

    await setComposerMode('Plan')
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

    await setComposerMode('Plan')

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

    await setComposerMode('Plan')

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

    await setComposerMode('Plan')

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
      if (method === 'bridge/reviewGit/readDiffSummary') {
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

  it('routes active-thread thinking effort changes to thread runtime state', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Model and thinking mode' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Medium' }))
    fireEvent.click(await screen.findByText('High'))

    await waitFor(() => {
      expect(
        rpcMock.requests.some((entry) =>
          entry.method === 'thread/runtimeState/patch' &&
          (entry.params as any)?.threadId === 'thread-alpha' &&
          (entry.params as any)?.patch?.preferences?.thinkingEffort === 'high'
        ),
      ).toBe(true)
    })
  })

  it('keeps draft thinking effort local instead of writing global defaults', async () => {
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
        if (threadId === 'thread-draft') return { data: [], nextCursor: null }
      }
      if (method === 'thread/start') {
        return {
          thread: {
            id: 'thread-draft',
            cwd: (params as { cwd?: string }).cwd ?? '/repo-alpha',
            createdAt: '2026-02-10T00:00:00.000Z',
            updatedAt: '2026-02-10T00:00:00.000Z',
            messageCount: 0,
            label: 'Draft Session',
          },
          effectiveCwd: (params as { cwd?: string }).cwd ?? '/repo-alpha',
        }
      }
      if (method === 'turn/start') return { turn: { id: 'turn-draft-1', status: 'running' } }
      return {}
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Alpha Session/i }))
    await screen.findByText('alpha reply')
    fireEvent.click(await screen.findByRole('button', { name: 'New thread' }))
    await screen.findByTestId('new-thread-draft-surface')
    fireEvent.click(screen.getByRole('button', { name: /Choose project/i }))
    fireEvent.click(await screen.findByRole('option', { name: /repo/i }))

    fireEvent.keyDown(screen.getByRole('button', { name: 'Model and thinking mode' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Medium' }))
    fireEvent.click(await screen.findByText('Max'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Model and thinking mode' })).toHaveTextContent(/Max/i)
    })

    expect(
      rpcMock.requests.some((entry) =>
        entry.method === 'config/runtimeDefaults/patch' &&
        (entry.params as any)?.thinkingEffort === 'max'
      ),
    ).toBe(false)
  })

  it('enters draft surface without creating a thread when clicking New thread', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
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

    await act(async () => {
      fireEvent.click(screen.getByTitle('/repo-beta'))
      fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    })

    expect(screen.getByTestId('new-thread-draft-surface')).toBeInTheDocument()
    expect(screen.queryByText('Choose a project before sending the first message.')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Choose a project first')).toBeDisabled()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
  })

  it('keeps draft input disabled until a project is selected when no recent projects are available', async () => {
    let resolveDiff: ((value: {
      cwd: string
      generatedAt: string
      hasChanges: boolean
      truncated: boolean
      files: never[]
    }) => void) | null = null

    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
        return new Promise((resolve) => {
          resolveDiff = resolve
        })
      }
      if (method === 'thread/list') {
        return { data: [] }
      }
      if (method === 'thread/start') {
        return {
          thread: {
            id: 'thread-empty-seed',
            cwd: '/workspace-empty',
            createdAt: '2026-02-10T00:01:00.000Z',
            updatedAt: '2026-02-10T00:01:00.000Z',
          },
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-empty-seed',
            threadId: 'thread-empty-seed',
            status: 'running',
          },
        }
      }
      if (method === 'thread/messages') {
        if ((params as { threadId?: string } | undefined)?.threadId === 'thread-empty-seed') {
          return { data: [], nextCursor: null }
        }
      }
      if (method === 'thread/resume') {
        return { thread: { id: (params as any)?.threadId ?? 'thread-empty-seed' }, staleInputs: [] }
      }
      if (method === 'thread/replay') {
        return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false }
      }
      return {}
    })

    render(<App />)

    await act(async () => {
      resolveDiff?.({
        cwd: '/workspace-empty',
        generatedAt: '2026-02-10T00:00:00.000Z',
        hasChanges: false,
        truncated: false,
        files: [],
      })
      await Promise.resolve()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'New thread' }))

    const disabledInput = await screen.findByPlaceholderText('Choose a project first')
    expect(disabledInput).toBeDisabled()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
  })

  it('prefills cwd from folder quick action and creates the thread on first send', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
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
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-new',
            threadId: 'thread-new',
            status: 'running',
          },
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

    fireEvent.click(screen.getByRole('button', { name: 'Start new thread in repo-beta' }))

    expect(screen.getByTestId('new-thread-draft-surface')).toBeInTheDocument()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'bridge/reviewGit/readDiffSummary' && (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
      ),
    ).toBe(false)

    const input = screen.getByPlaceholderText('Ask for follow-up changes')
    fireEvent.change(input, { target: { value: 'draft hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(screen.getAllByText('draft hello')).toHaveLength(1)
    })

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) => entry.method === 'thread/start' && (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
        ),
      ).toBe(true)
    })

    expect(
      rpcMock.requests.some(
        (entry) =>
          entry.method === 'turn/start' &&
          (entry.params as any)?.threadId === 'thread-new' &&
          (entry.params as any)?.input?.text === 'draft hello' &&
          (entry.params as any)?.cwd === '/repo-beta',
      ),
    ).toBe(true)

    const threadStartIndex = rpcMock.requests.findIndex(
      (entry) => entry.method === 'thread/start' && (entry.params as { cwd?: string } | undefined)?.cwd === '/repo-beta',
    )
    const firstTurnStartIndex = rpcMock.requests.findIndex(
      (entry) =>
        entry.method === 'turn/start' &&
        (entry.params as any)?.threadId === 'thread-new' &&
        (entry.params as any)?.input?.text === 'draft hello',
    )
    const refreshBetweenDraftCreateAndFirstTurn = rpcMock.requests.slice(threadStartIndex + 1, firstTurnStartIndex).some((entry) => {
      return entry.method === 'thread/list' || entry.method === 'bridge/reviewGit/readDiffSummary'
    })

    expect(threadStartIndex).toBeGreaterThanOrEqual(0)
    expect(firstTurnStartIndex).toBeGreaterThan(threadStartIndex)
    expect(refreshBetweenDraftCreateAndFirstTurn).toBe(false)
  })

  it('leaves unsent draft without creating a thread when selecting an existing thread', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Alpha Session/i })

    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(screen.getByTestId('new-thread-draft-surface')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Beta Session/i }))

    await screen.findByText('beta reply')
    expect(screen.queryByTestId('new-thread-draft-surface')).not.toBeInTheDocument()
    expect(rpcMock.requests.some((entry) => entry.method === 'thread/start')).toBe(false)
  })

  it('hides folders provided by thread/list hiddenGroupCwds', async () => {
    rpcMock.setRequestImpl((method, params) => {
      if (method === 'initialize') return {}
      if (method === 'bridge/reviewGit/readDiffSummary') {
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
      if (method === 'bridge/reviewGit/readDiffSummary') {
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

  it('uses command/dispatch for /init, /todos, /context, and /context --json', async () => {
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

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.command === '/context',
        ),
      ).toBe(true)
    })
    expect(rpcMock.requests.some((entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/context')).toBe(
      false,
    )
    expect(await screen.findByText('Context diagnostics')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Ask for follow-up changes'), { target: { value: '/context --json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(
        rpcMock.requests.some(
          (entry) =>
            entry.method === 'command/dispatch' &&
            (entry.params as any)?.threadId === 'thread-alpha' &&
            (entry.params as any)?.command === '/context --json',
        ),
      ).toBe(true)
    })
    expect(
      rpcMock.requests.some(
        (entry) => entry.method === 'turn/start' && (entry.params as any)?.input?.text === '/context --json',
      ),
    ).toBe(false)
    expect(await screen.findByText(/"kind": "formax.context_diagnostics"/)).toBeInTheDocument()

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


})
