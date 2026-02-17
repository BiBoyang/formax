import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTurnEventCursorState } from '../../turnEventCursor'
import { REPLAY_FIXTURE_THREAD_ID } from './testFixtures/replayFixtures'

const mockRpcState = vi.hoisted(() => ({
  handlers: null as
    | {
        onStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
        onNotification: (notification: unknown) => void
        onError: (error: Error) => void
      }
    | null,
  disconnect: vi.fn(),
}))

vi.mock('../../rpcClient', () => {
  class MockRpcClient {
    connect(_url: string, handlers: typeof mockRpcState.handlers extends infer T ? NonNullable<T> : never) {
      mockRpcState.handlers = handlers
    }

    disconnect() {
      mockRpcState.disconnect()
    }
  }

  return { RpcClient: MockRpcClient }
})

import { connectRpcClient } from './connectRpcClient'

describe('connectRpcClient', () => {
  beforeEach(() => {
    mockRpcState.handlers = null
    mockRpcState.disconnect.mockReset()
  })

  it('replays the active thread on connected status using shared replay fixture id', async () => {
    const clientRef = { current: null as any }
    const eventCursorRef = { current: createTurnEventCursorState(20) }
    const dispatch = vi.fn()
    const initializeHandshake = vi.fn(async () => {})
    const refreshThreads = vi.fn(async () => {})
    const refreshWorkspaceDiff = vi.fn(async () => {})
    const resumeThreadInputs = vi.fn(async () => {})
    const replayThreadEvents = vi.fn(async () => true)
    const handleNotification = vi.fn()
    const captureError = vi.fn((method, error) => ({ method, error }))

    const dispose = connectRpcClient({
      bridgeUrl: 'ws://localhost:3001',
      seenEventCap: 20,
      dispatch,
      clientRef,
      eventCursorRef,
      initializeHandshake,
      refreshThreads,
      refreshWorkspaceDiff,
      resumeThreadInputs,
      replayThreadEvents,
      activeThreadIdRef: { current: REPLAY_FIXTURE_THREAD_ID },
      handleNotification,
      captureError,
    })

    expect(clientRef.current).not.toBeNull()
    expect(mockRpcState.handlers).not.toBeNull()

    mockRpcState.handlers?.onStatus('connected')

    await vi.waitFor(() => {
      expect(initializeHandshake).toHaveBeenCalled()
      expect(refreshThreads).toHaveBeenCalled()
      expect(refreshWorkspaceDiff).toHaveBeenCalled()
      expect(resumeThreadInputs).toHaveBeenCalledWith(REPLAY_FIXTURE_THREAD_ID)
      expect(replayThreadEvents).toHaveBeenCalledWith(REPLAY_FIXTURE_THREAD_ID)
    })

    dispose()

    expect(mockRpcState.disconnect).toHaveBeenCalledTimes(1)
    expect(clientRef.current).toBeNull()
  })

  it('replays again after disconnected -> connected transition', async () => {
    const clientRef = { current: null as any }
    const eventCursorRef = { current: createTurnEventCursorState(20) }
    const initializeHandshake = vi.fn(async () => {})
    const refreshThreads = vi.fn(async () => {})
    const refreshWorkspaceDiff = vi.fn(async () => {})
    const resumeThreadInputs = vi.fn(async () => {})
    const replayThreadEvents = vi.fn(async () => true)

    connectRpcClient({
      bridgeUrl: 'ws://localhost:3001',
      seenEventCap: 20,
      dispatch: vi.fn(),
      clientRef,
      eventCursorRef,
      initializeHandshake,
      refreshThreads,
      refreshWorkspaceDiff,
      resumeThreadInputs,
      replayThreadEvents,
      activeThreadIdRef: { current: REPLAY_FIXTURE_THREAD_ID },
      handleNotification: vi.fn(),
      captureError: vi.fn((method, error) => ({ method, error })),
    })

    mockRpcState.handlers?.onStatus('connected')

    await vi.waitFor(() => {
      expect(replayThreadEvents).toHaveBeenCalledTimes(1)
      expect(replayThreadEvents).toHaveBeenLastCalledWith(REPLAY_FIXTURE_THREAD_ID)
    })

    mockRpcState.handlers?.onStatus('disconnected')
    mockRpcState.handlers?.onStatus('connected')

    await vi.waitFor(() => {
      expect(replayThreadEvents).toHaveBeenCalledTimes(2)
      expect(replayThreadEvents).toHaveBeenNthCalledWith(2, REPLAY_FIXTURE_THREAD_ID)
    })
  })
})
