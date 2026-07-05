import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSummary } from '../../../types'

const rpcState = vi.hoisted(() => ({
  requestLog: [] as Array<{ method: string; params: unknown }>,
  notifyLog: [] as Array<{ method: string; params: unknown }>,
  handlers: null as null | {
    onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
    onNotification: (notification: unknown) => void
    onError: (error: Error) => void
  },
}))

function buildThread(id: string, updatedAt: string, cwd: string): ThreadSummary {
  return {
    id,
    cwd,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
    label: null,
    lastUserPrompt: null,
  }
}

const thread1 = buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1')
const thread2 = buildThread('thread-2', '2026-02-22T02:00:00Z', '/repo-2')

vi.mock('../../../rpcClient', () => {
  class MockRpcClient {
    connect(
      _url: string,
      handlers: {
        onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
        onNotification: (notification: unknown) => void
        onError: (error: Error) => void
      },
    ) {
      rpcState.handlers = handlers
      handlers.onStatus('connecting')
      queueMicrotask(() => handlers.onStatus('connected'))
    }

    disconnect() {
      rpcState.handlers = null
    }

    async request(method: string, params?: unknown): Promise<unknown> {
      rpcState.requestLog.push({ method, params: params ?? null })
      switch (method) {
        case 'initialize':
          return {}
        case 'thread/list':
          return { data: [thread1, thread2] }
        case 'bridge/reviewGit/readDiffSummary':
          return {
            cwd: typeof (params as { cwd?: unknown } | null)?.cwd === 'string' ? (params as { cwd: string }).cwd : '/repo-1',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
            generatedAt: '2026-02-22T00:00:00.000Z',
            hasChanges: false,
            truncated: false,
            files: [],
          }
        case 'thread/replay':
          return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false, state: null }
        case 'thread/messages':
          return { data: [], nextCursor: null }
        case 'thread/resume':
          return { staleInputs: [] }
        default:
          throw new Error(`Unhandled rpc method in urlSync integration: ${method}`)
      }
    }

    notify(method: string, params?: unknown): void {
      rpcState.notifyLog.push({ method, params: params ?? null })
    }
  }

  return { RpcClient: MockRpcClient }
})

import { useAppRuntime } from '../../useAppRuntime'

describe('URL Sync Integration', () => {
  beforeEach(() => {
    rpcState.requestLog.length = 0
    rpcState.notifyLog.length = 0
    rpcState.handlers = null
    window.history.replaceState({}, '', window.location.pathname)
  })

  it('updates ?thread= when active thread changes', async () => {
    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.length).toBeGreaterThan(0)
    })

    act(() => {
      result.current.onSelectThread('thread-2')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-2')
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-2')
    })
  })

  it('restores active thread from URL on mount', async () => {
    window.history.replaceState({}, '', `${window.location.pathname}?thread=thread-2`)

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-2')
      expect(new URL(window.location.href).searchParams.get('thread')).toBe('thread-2')
    })
  })

  it('falls back to null for invalid thread id in URL', async () => {
    window.history.replaceState({}, '', `${window.location.pathname}?thread=missing-thread`)

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.length).toBeGreaterThan(0)
      expect(result.current.activeThreadId).toBe(null)
      expect(result.current.visibleSurface).toBe('newThreadDraft')
      expect(result.current.diffSnapshot).toBeNull()
      expect(new URL(window.location.href).searchParams.get('thread')).toBeNull()
    })
    expect(rpcState.requestLog.some(({ method }) => method === 'bridge/reviewGit/readDiffSummary')).toBe(false)
  })
})
