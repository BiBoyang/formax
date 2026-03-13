import { describe, expect, it, vi } from 'vitest'
import type { RpcClientQueueMetrics } from '../../rpcClient'
import { applyRpcQueueMetricsDelta } from './rpcQueueMetrics'

describe('rpcQueueMetrics', () => {
  it('stores first metrics snapshot without logging', () => {
    const log = vi.fn()
    const metricsRef: { current: RpcClientQueueMetrics | null } = { current: null }

    applyRpcQueueMetricsDelta({
      metricsRef,
      log,
      metrics: {
        overloadedRequests: 1,
        droppedOutboundNotifications: 1,
        droppedInboundNotifications: 1,
        outboundQueueDepth: 2,
        outboundQueueCapacity: 4,
        inboundNotificationQueueDepth: 3,
        inboundNotificationQueueCapacity: 8,
      },
    })

    expect(log).not.toHaveBeenCalled()
    expect(metricsRef.current?.overloadedRequests).toBe(1)
  })

  it('logs positive deltas for overloaded and dropped metrics', () => {
    const log = vi.fn()
    const metricsRef = {
      current: {
        overloadedRequests: 1,
        droppedOutboundNotifications: 2,
        droppedInboundNotifications: 3,
        outboundQueueDepth: 1,
        outboundQueueCapacity: 10,
        inboundNotificationQueueDepth: 1,
        inboundNotificationQueueCapacity: 10,
      },
    }

    applyRpcQueueMetricsDelta({
      metricsRef,
      log,
      metrics: {
        overloadedRequests: 4,
        droppedOutboundNotifications: 2,
        droppedInboundNotifications: 6,
        outboundQueueDepth: 7,
        outboundQueueCapacity: 10,
        inboundNotificationQueueDepth: 8,
        inboundNotificationQueueCapacity: 10,
      },
    })

    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenNthCalledWith(
      1,
      '[rpc] outbound request queue overloaded (+3, depth 7/10)',
      'warn',
    )
    expect(log).toHaveBeenNthCalledWith(
      2,
      '[rpc] dropped inbound notifications (+3, depth 8/10)',
      'warn',
    )
  })
})
