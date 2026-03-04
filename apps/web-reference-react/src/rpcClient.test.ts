import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcClient, RpcQueueOverloadedError } from './rpcClient'
import type { RpcNotification } from './types'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  throwOnSend: Error | null = null
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  send(payload: string): void {
    if (this.throwOnSend) throw this.throwOnSend
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sent.push(payload)
  }

  receive(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    this.onmessage?.({ data } as MessageEvent)
  }
}

function getSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  if (!socket) {
    throw new Error('expected active mock websocket')
  }
  return socket
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RpcClient outbound queue', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    MockWebSocket.instances = []
    ;(globalThis as { WebSocket: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    ;(globalThis as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket
  })

  it('queues request payloads and preserves send order', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn((notification: RpcNotification) => notification),
      onError: vi.fn(),
    }
    const client = new RpcClient({ outboundQueueCapacity: 4 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()

    const first = client.request('thread/list', { limit: 1 })
    const second = client.request('thread/list', { limit: 2 })

    expect(socket.sent).toHaveLength(0)
    await flushMicrotasks()
    expect(socket.sent).toHaveLength(2)

    const firstPayload = JSON.parse(socket.sent[0] ?? '{}') as { id?: number; method?: string }
    const secondPayload = JSON.parse(socket.sent[1] ?? '{}') as { id?: number; method?: string }
    expect(firstPayload.method).toBe('thread/list')
    expect(firstPayload.id).toBe(1)
    expect(secondPayload.method).toBe('thread/list')
    expect(secondPayload.id).toBe(2)

    socket.receive({ jsonrpc: '2.0', id: 1, result: { ok: 'first' } })
    socket.receive({ jsonrpc: '2.0', id: 2, result: { ok: 'second' } })

    await expect(first).resolves.toEqual({ ok: 'first' })
    await expect(second).resolves.toEqual({ ok: 'second' })
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('rejects request when outbound queue is saturated', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    }
    const client = new RpcClient({ outboundQueueCapacity: 1 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()

    const first = client.request('thread/list', { limit: 1 })
    await expect(client.request('thread/read', { threadId: 'thread-1' })).rejects.toBeInstanceOf(RpcQueueOverloadedError)

    await flushMicrotasks()
    expect(socket.sent).toHaveLength(1)
    const firstPayload = JSON.parse(socket.sent[0] ?? '{}') as { id?: number; method?: string }
    expect(firstPayload.method).toBe('thread/list')
    expect(firstPayload.id).toBe(1)

    socket.receive({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('drops notifications when outbound queue is saturated and reports overload', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    }
    const client = new RpcClient({ outboundQueueCapacity: 1 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()

    client.notify('initialized')
    client.notify('turn/started', { turnId: 'turn-1' })

    await flushMicrotasks()
    expect(socket.sent).toHaveLength(1)
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect(handlers.onError.mock.calls[0]?.[0]).toBeInstanceOf(RpcQueueOverloadedError)
  })

  it('rejects pending request and closes socket when send throws', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    }
    const client = new RpcClient({ outboundQueueCapacity: 2 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()
    socket.throwOnSend = new Error('writer down')

    const requestPromise = client.request('thread/list', { limit: 1 })
    await flushMicrotasks()

    await expect(requestPromise).rejects.toThrow('writer down')
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect((handlers.onError.mock.calls[0] ?? [])[0]).toEqual(expect.objectContaining({ message: 'writer down' }))
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
  })

  it('buffers inbound notifications and drains them in order', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    }
    const client = new RpcClient({ inboundNotificationQueueCapacity: 4 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()

    socket.receive({ jsonrpc: '2.0', method: 'turn/started', params: { turnId: 'turn-1' } })
    socket.receive({ jsonrpc: '2.0', method: 'turn/completed', params: { turnId: 'turn-1' } })

    expect(handlers.onNotification).toHaveBeenCalledTimes(0)
    await flushMicrotasks()
    expect(handlers.onNotification).toHaveBeenCalledTimes(2)
    expect(handlers.onNotification.mock.calls[0]?.[0]).toMatchObject({ method: 'turn/started' })
    expect(handlers.onNotification.mock.calls[1]?.[0]).toMatchObject({ method: 'turn/completed' })
  })

  it('drops inbound notifications when inbound queue is saturated', async () => {
    const handlers = {
      onStatus: vi.fn(),
      onNotification: vi.fn(),
      onError: vi.fn(),
    }
    const client = new RpcClient({ inboundNotificationQueueCapacity: 1 })
    client.connect('ws://127.0.0.1:3777', handlers)

    const socket = getSocket()
    socket.open()

    socket.receive({ jsonrpc: '2.0', method: 'turn/started', params: { turnId: 'turn-1' } })
    socket.receive({ jsonrpc: '2.0', method: 'turn/event', params: { turnId: 'turn-1' } })

    await flushMicrotasks()
    expect(handlers.onNotification).toHaveBeenCalledTimes(1)
    expect(handlers.onNotification.mock.calls[0]?.[0]).toMatchObject({ method: 'turn/started' })
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    const overload = handlers.onError.mock.calls[0]?.[0]
    expect(overload).toBeInstanceOf(RpcQueueOverloadedError)
    expect((overload as RpcQueueOverloadedError).queue).toBe('inbound_notification')
  })
})
