import type { RpcClientQueueMetrics } from '../../rpcClient'

type LogFn = (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void

export function applyRpcQueueMetricsDelta(args: {
  metrics: RpcClientQueueMetrics
  metricsRef: { current: RpcClientQueueMetrics | null }
  log: LogFn
}) {
  const previous = args.metricsRef.current
  args.metricsRef.current = args.metrics
  if (!previous) return

  const overloadedDelta = args.metrics.overloadedRequests - previous.overloadedRequests
  if (overloadedDelta > 0) {
    args.log(
      `[rpc] outbound request queue overloaded (+${overloadedDelta}, depth ${args.metrics.outboundQueueDepth}/${args.metrics.outboundQueueCapacity})`,
      'warn',
    )
  }

  const droppedOutboundDelta = args.metrics.droppedOutboundNotifications - previous.droppedOutboundNotifications
  if (droppedOutboundDelta > 0) {
    args.log(
      `[rpc] dropped outbound notifications (+${droppedOutboundDelta}, depth ${args.metrics.outboundQueueDepth}/${args.metrics.outboundQueueCapacity})`,
      'warn',
    )
  }

  const droppedInboundDelta = args.metrics.droppedInboundNotifications - previous.droppedInboundNotifications
  if (droppedInboundDelta > 0) {
    args.log(
      `[rpc] dropped inbound notifications (+${droppedInboundDelta}, depth ${args.metrics.inboundNotificationQueueDepth}/${args.metrics.inboundNotificationQueueCapacity})`,
      'warn',
    )
  }
}
