import { describe, expect, it } from 'vitest'
import { resolveRpcQueueRuntimeConfig } from './rpcQueueConfig'

describe('resolveRpcQueueRuntimeConfig', () => {
  it('returns empty config when window is missing', () => {
    expect(resolveRpcQueueRuntimeConfig({ windowObj: null })).toEqual({})
  })

  it('returns empty config when runtime value is not an object', () => {
    const windowObj = { __FORMAX_RPC_QUEUE__: 'invalid' } as unknown as Window
    expect(resolveRpcQueueRuntimeConfig({ windowObj })).toEqual({})
  })

  it('parses positive queue capacities from runtime config', () => {
    const windowObj = {
      __FORMAX_RPC_QUEUE__: {
        outboundQueueCapacity: 96.8,
        inboundNotificationQueueCapacity: 320,
      },
    } as unknown as Window
    expect(resolveRpcQueueRuntimeConfig({ windowObj })).toEqual({
      outboundQueueCapacity: 96,
      inboundNotificationQueueCapacity: 320,
    })
  })

  it('accepts numeric strings and ignores non-positive values', () => {
    const windowObj = {
      __FORMAX_RPC_QUEUE__: {
        outboundQueueCapacity: '32',
        inboundNotificationQueueCapacity: 0,
      },
    } as unknown as Window
    expect(resolveRpcQueueRuntimeConfig({ windowObj })).toEqual({
      outboundQueueCapacity: 32,
    })
  })
})
