import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRpcRequest } from './useRpcRequest'

describe('useRpcRequest', () => {
  it('returns rpc result when client request succeeds', async () => {
    const requestMock = vi.fn().mockResolvedValue({ ok: true })
    const log = vi.fn()
    const clientRef = { current: { request: requestMock } as any }

    const { result } = renderHook(() => useRpcRequest({ clientRef, log }))
    await expect(result.current.request('thread/list', { limit: 1 })).resolves.toEqual({ ok: true })

    expect(result.current.lastRpcError).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('captures and logs rpc errors from client request', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('boom'))
    const log = vi.fn()
    const clientRef = { current: { request: requestMock } as any }

    const { result } = renderHook(() => useRpcRequest({ clientRef, log }))
    await act(async () => {
      await expect(result.current.request('turn/start', { threadId: 't1' })).rejects.toThrow('boom')
    })

    await waitFor(() => {
      expect(result.current.lastRpcError?.method).toBe('turn/start')
    })
    expect(result.current.lastRpcError?.message).toBe('boom')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[turn/start] boom'), 'error')
  })

  it('fails fast when rpc client is missing', async () => {
    const log = vi.fn()
    const clientRef = { current: null as any }

    const { result } = renderHook(() => useRpcRequest({ clientRef, log }))
    await expect(result.current.request('thread/list')).rejects.toThrow('RPC client is not ready')

    expect(log).not.toHaveBeenCalled()
  })
})
