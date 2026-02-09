import type { JsonRpcId, RpcErrorObject, RpcNotification, RpcRequest, RpcResponse } from './types'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

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

export class RpcClient {
  private socket: WebSocket | null = null
  private socketGeneration = 0
  private nextRequestId = 1
  private pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  connect(url: string, handlers: RpcClientHandlers): void {
    this.disconnect()
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
    socket.send(JSON.stringify(request))

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
    socket.send(JSON.stringify(notification))
  }
}
