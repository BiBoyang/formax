import { useCallback } from 'react'
import type { RpcClient } from '../../rpcClient'

export function useInitializeHandshake(args: { clientRef: { current: RpcClient | null } }) {
  const { clientRef } = args

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    client.notify('initialized')
  }, [clientRef])

  return {
    initializeHandshake,
  }
}
