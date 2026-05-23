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
  threads: [] as ThreadSummary[],
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
          return { data: rpcState.threads }
        case 'bridge/readDiffSummary':
          return {
            cwd: typeof (params as { cwd?: unknown } | null)?.cwd === 'string' ? (params as { cwd: string }).cwd : '/repo',
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
        case 'thread/archive': {
          const body = (params ?? {}) as { threadId?: unknown; opId?: unknown }
          const threadId = typeof body.threadId === 'string' ? body.threadId : ''
          const opId = typeof body.opId === 'string' ? body.opId : ''
          rpcState.threads = rpcState.threads.filter((thread) => thread.id !== threadId)
          if (threadId && rpcState.handlers) {
            queueMicrotask(() => {
              rpcState.handlers?.onNotification({
                jsonrpc: '2.0',
                method: 'thread/archived',
                params: opId ? { threadId, opId } : { threadId },
              })
            })
          }
          return {}
        }
        default:
          throw new Error(`Unhandled rpc method in threadArchiving integration: ${method}`)
      }
    }

    notify(method: string, params?: unknown): void {
      rpcState.notifyLog.push({ method, params: params ?? null })
    }
  }

  return { RpcClient: MockRpcClient }
})

import { useAppRuntime } from '../../useAppRuntime'

describe('Thread Archiving Integration', () => {
  beforeEach(() => {
    rpcState.requestLog.length = 0
    rpcState.notifyLog.length = 0
    rpcState.handlers = null
    rpcState.threads = []
    window.history.replaceState({}, '', window.location.pathname)
  })

  it('selects fallback active thread by updatedAt after archiving current thread', async () => {
    rpcState.threads = [
      buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1'),
      buildThread('thread-2', '2026-02-22T02:00:00Z', '/repo-2'),
    ]

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-2', 'thread-1'])
    })

    act(() => {
      result.current.onSelectThread('thread-2')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-2')
    })

    act(() => {
      result.current.onArchiveThread('thread-2')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-1')
      expect(result.current.selectedCwd).toBe('/repo-1')
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-1'])
      expect(result.current.noticeMessage).toMatch(/Archived/)
    })
  })

  it('falls back to null and clears UI state when archiving the last thread', async () => {
    rpcState.threads = [buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1')]

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-1'])
    })

    act(() => {
      result.current.onSelectThread('thread-1')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-1')
    })

    await waitFor(() => {
      expect(
        rpcState.requestLog.filter(({ method }) => method === 'bridge/readDiffSummary').length,
      ).toBeGreaterThan(0)
    })
    const diffRequestCountBeforeArchive = rpcState.requestLog.filter(
      ({ method }) => method === 'bridge/readDiffSummary',
    ).length

    act(() => {
      result.current.onArchiveThread('thread-1')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe(null)
      expect(result.current.visibleSurface).toBe('newThreadDraft')
      expect(result.current.mode).toBe('normal')
      expect(result.current.selectedCwd).toBe(null)
      expect(result.current.diffSnapshot).toBeNull()
      expect(result.current.logs).toEqual([])
      expect(result.current.sortedThreads).toEqual([])
    })
    expect(
      rpcState.requestLog.filter(({ method }) => method === 'bridge/readDiffSummary').length,
    ).toBe(diffRequestCountBeforeArchive)
  })

  it('clears selected workspace and diff state when entering an unscoped draft from a thread', async () => {
    rpcState.threads = [buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1')]

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-1'])
    })

    act(() => {
      result.current.onSelectThread('thread-1')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-1')
      expect(result.current.selectedCwd).toBe('/repo-1')
      expect(result.current.diffSnapshot?.cwd).toBe('/repo-1')
    })

    act(() => {
      result.current.onEnterNewThreadDraft()
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe(null)
      expect(result.current.visibleSurface).toBe('newThreadDraft')
      expect(result.current.selectedCwd).toBeNull()
      expect(result.current.diffSnapshot).toBeNull()
    })
  })

  it('preserves scoped draft workspace selection until header ownership moves to draft cwd', async () => {
    rpcState.threads = [buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1')]

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-1'])
    })

    act(() => {
      result.current.onSelectThread('thread-1')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe('thread-1')
      expect(result.current.diffSnapshot?.cwd).toBe('/repo-1')
    })

    act(() => {
      result.current.onEnterNewThreadDraftInCwd('/repo-draft')
    })

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe(null)
      expect(result.current.visibleSurface).toBe('newThreadDraft')
      expect(result.current.selectedCwd).toBe('/repo-draft')
      expect(result.current.diffSnapshot).toBeNull()
    })
  })

  it('handles thread/archived notification without opId', async () => {
    rpcState.threads = [
      buildThread('thread-1', '2026-02-22T01:00:00Z', '/repo-1'),
      buildThread('thread-2', '2026-02-22T02:00:00Z', '/repo-2'),
    ]

    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads.length).toBe(2)
    })

    act(() => {
      rpcState.handlers?.onNotification({
        jsonrpc: '2.0',
        method: 'thread/archived',
        params: { threadId: 'thread-2' },
      })
    })

    await waitFor(() => {
      expect(result.current.sortedThreads.map((thread) => thread.id)).toEqual(['thread-1'])
    })
  })
})
