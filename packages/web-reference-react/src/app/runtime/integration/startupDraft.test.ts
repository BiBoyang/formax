import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcState = vi.hoisted(() => ({
  requestLog: [] as Array<{ method: string; params: unknown }>,
  notifyLog: [] as Array<{ method: string; params: unknown }>,
  handlers: null as null | {
    onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
    onNotification: (notification: unknown) => void
    onError: (error: Error) => void
  },
}))

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
          return { data: [] }
        default:
          throw new Error(`Unhandled rpc method in startupDraft integration: ${method}`)
      }
    }

    notify(method: string, params?: unknown): void {
      rpcState.notifyLog.push({ method, params: params ?? null })
    }
  }

  return { RpcClient: MockRpcClient }
})

import { useAppRuntime } from '../../useAppRuntime'

describe('Startup Draft Integration', () => {
  beforeEach(() => {
    rpcState.requestLog.length = 0
    rpcState.notifyLog.length = 0
    rpcState.handlers = null
    window.history.replaceState({}, '', window.location.pathname)
  })

  it('starts on the draft surface when no threads exist', async () => {
    const { result } = renderHook(() => useAppRuntime())

    await waitFor(() => {
      expect(result.current.sortedThreads).toEqual([])
      expect(result.current.activeThreadId).toBeNull()
      expect(result.current.visibleSurface).toBe('newThreadDraft')
      expect(result.current.selectedCwd).toBeNull()
      expect(result.current.diffSnapshot).toBeNull()
    })

    expect(rpcState.requestLog.some(({ method }) => method === 'bridge/reviewGit/readDiffSummary')).toBe(false)
  })
})
