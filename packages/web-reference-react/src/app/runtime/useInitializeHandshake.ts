import { useCallback } from 'react'
import type { RpcClient } from '../../rpcClient'
import { parseInitializeResponse, type RpcInitializeResult } from '../core/rpcContracts'

export function useInitializeHandshake(args: {
  clientRef: { current: RpcClient | null }
  onInitializeResult?: (result: RpcInitializeResult) => void
}) {
  const { clientRef, onInitializeResult } = args

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    const result = await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    onInitializeResult?.(parseInitializeResponse(result))
    client.notify('initialized')
  }, [clientRef, onInitializeResult])

  return {
    initializeHandshake,
  }
}
