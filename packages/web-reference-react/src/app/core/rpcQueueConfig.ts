export type RpcQueueRuntimeConfig = {
  outboundQueueCapacity?: number
  inboundNotificationQueueCapacity?: number
}

type RpcQueueConfigWindow = Window & {
  __FORMAX_RPC_QUEUE__?: unknown
}

function normalizePositiveLimit(value: unknown): number | undefined {
  const fromNumber = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(fromNumber)) return undefined
  const rounded = Math.floor(fromNumber)
  if (rounded < 1) return undefined
  return rounded
}

export function resolveRpcQueueRuntimeConfig(args?: {
  windowObj?: Window | null
}): RpcQueueRuntimeConfig {
  const windowObj = args?.windowObj ?? (typeof window === 'undefined' ? null : window)
  if (!windowObj) return {}

  const raw = (windowObj as RpcQueueConfigWindow).__FORMAX_RPC_QUEUE__
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>

  const outboundQueueCapacity = normalizePositiveLimit(record.outboundQueueCapacity)
  const inboundNotificationQueueCapacity = normalizePositiveLimit(record.inboundNotificationQueueCapacity)

  return {
    ...(outboundQueueCapacity === undefined ? {} : { outboundQueueCapacity }),
    ...(inboundNotificationQueueCapacity === undefined ? {} : { inboundNotificationQueueCapacity }),
  }
}
