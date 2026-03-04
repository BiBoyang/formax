import type { JsonRpcId, RpcErrorObject, RpcNotification, RpcRequest, RpcResponse } from './types'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export const RPC_CLIENT_DEFAULT_OUTBOUND_QUEUE_CAPACITY = 128
const RPC_CLIENT_OVERLOADED_CODE = -32001

export type RpcClientHandlers = {
  onStatus: (status: ConnectionStatus) => void
  onNotification: (notification: RpcNotification) => void
  onError: (error: Error) => void
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== 'object') return false
  return 'id' in value && 'jsonrpc' in value
}

export class RpcRequestError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(error: RpcErrorObject) {
    super(error.message)
    this.name = 'RpcRequestError'
    this.code = error.code
    this.data = error.data
  }
}

export class RpcQueueOverloadedError extends Error {
  readonly code = RPC_CLIENT_OVERLOADED_CODE
  readonly queue: 'outbound'
  readonly messageKind: 'request' | 'notification'

  constructor(args: { messageKind: 'request' | 'notification'; detail: string }) {
    super(`RPC queue overloaded: ${args.detail}`)
    this.name = 'RpcQueueOverloadedError'
    this.queue = 'outbound'
    this.messageKind = args.messageKind
  }
}

type OutboundQueueItem =
  | { kind: 'request'; requestId: JsonRpcId; payload: string }
  | { kind: 'notification'; method: string; payload: string }

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

export class RpcClient {
  private readonly outboundQueueCapacity: number
  private socket: WebSocket | null = null
  private handlers: RpcClientHandlers | null = null
  private socketGeneration = 0
  private nextRequestId = 1
  private outboundQueue: OutboundQueueItem[] = []
  private outboundFlushScheduled = false
  private pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  constructor(args?: { outboundQueueCapacity?: number }) {
    this.outboundQueueCapacity = normalizePositiveLimit(
      args?.outboundQueueCapacity,
      RPC_CLIENT_DEFAULT_OUTBOUND_QUEUE_CAPACITY,
    )
  }

  connect(url: string, handlers: RpcClientHandlers): void {
    this.disconnect()
    this.handlers = handlers
    handlers.onStatus('connecting')

    const generation = ++this.socketGeneration
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      if (this.socketGeneration !== generation) return
      handlers.onStatus('connected')
    }

    socket.onclose = () => {
      if (this.socketGeneration !== generation) return
      handlers.onStatus('disconnected')
      this.socket = null
      this.clearOutboundQueue()
      for (const request of this.pending.values()) {
        request.reject(new Error('Bridge disconnected'))
      }
      this.pending.clear()
    }

    socket.onerror = () => {
      if (this.socketGeneration !== generation) return
      handlers.onError(new Error('WebSocket error'))
    }

    socket.onmessage = (event) => {
      if (this.socketGeneration !== generation) return
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        handlers.onError(new Error('Invalid JSON from bridge'))
        return
      }

      if (isRpcResponse(parsed)) {
        const request = this.pending.get(parsed.id)
        if (!request) return
        this.pending.delete(parsed.id)
        if (parsed.error) {
          request.reject(new RpcRequestError(parsed.error))
        } else {
          request.resolve(parsed.result)
        }
        return
      }

      handlers.onNotification(parsed as RpcNotification)
    }
  }

  disconnect(): void {
    this.socketGeneration += 1
    const socket = this.socket
    this.handlers = null
    this.clearOutboundQueue()
    if (!socket) return
    this.socket = null
    for (const request of this.pending.values()) {
      request.reject(new Error('Bridge disconnected'))
    }
    this.pending.clear()
    socket.close()
  }

  async request(method: string, params?: unknown): Promise<any> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Bridge is not connected')
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    const request: RpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }
    const payload = JSON.stringify(request)
    if (!this.tryEnqueueOutbound({ kind: 'request', requestId: id, payload })) {
      throw new RpcQueueOverloadedError({
        messageKind: 'request',
        detail: `outbound request queue capacity ${this.outboundQueueCapacity} reached`,
      })
    }
    this.scheduleOutboundFlush(this.socketGeneration)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  notify(method: string, params?: unknown): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    }
    const payload = JSON.stringify(notification)
    if (!this.tryEnqueueOutbound({ kind: 'notification', method, payload })) {
      this.handlers?.onError(
        new RpcQueueOverloadedError({
          messageKind: 'notification',
          detail: `outbound notification queue capacity ${this.outboundQueueCapacity} reached; dropped method ${method}`,
        }),
      )
      return
    }
    this.scheduleOutboundFlush(this.socketGeneration)
  }

  private tryEnqueueOutbound(item: OutboundQueueItem): boolean {
    if (this.outboundQueue.length >= this.outboundQueueCapacity) return false
    this.outboundQueue.push(item)
    return true
  }

  private clearOutboundQueue(): void {
    this.outboundQueue = []
    this.outboundFlushScheduled = false
  }

  private scheduleOutboundFlush(generation: number): void {
    if (this.outboundFlushScheduled) return
    this.outboundFlushScheduled = true
    queueMicrotask(() => {
      this.outboundFlushScheduled = false
      this.flushOutboundQueue(generation)
    })
  }

  private flushOutboundQueue(generation: number): void {
    if (this.socketGeneration !== generation) return
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    while (this.outboundQueue.length > 0) {
      const currentSocket = this.socket
      if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) return
      const item = this.outboundQueue.shift()!
      try {
        currentSocket.send(item.payload)
      } catch (error) {
        if (item.kind === 'request') {
          const pending = this.pending.get(item.requestId)
          this.pending.delete(item.requestId)
          pending?.reject(error instanceof Error ? error : new Error(String(error)))
        }
        this.handlers?.onError(error instanceof Error ? error : new Error(String(error)))
        currentSocket.close()
        return
      }
    }
  }
}
