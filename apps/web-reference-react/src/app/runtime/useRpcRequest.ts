import { useCallback, useState } from 'react'
import type { RpcClient } from '../../rpcClient'
import { toRpcError, type RpcErrorDetails } from '../core/threadTransforms'

export function useRpcRequest(args: {
  clientRef: { current: RpcClient | null }
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
}) {
  const { clientRef, log } = args
  const [lastRpcError, setLastRpcError] = useState<RpcErrorDetails | null>(null)

  const captureError = useCallback(
    (method: string, error: unknown) => {
      const details = toRpcError(method, error)
      setLastRpcError(details)
      log(`[${method}] ${details.message}${details.code != null ? ` (code ${details.code})` : ''}`, 'error')
      return details
    },
    [log],
  )

  const request = useCallback(
    async (method: string, params?: unknown): Promise<any> => {
      const client = clientRef.current
      if (!client) throw new Error('RPC client is not ready')
      try {
        return await client.request(method, params)
      } catch (error) {
        captureError(method, error)
        throw error
      }
    },
    [captureError, clientRef],
  )

  return {
    lastRpcError,
    captureError,
    request,
  }
}
