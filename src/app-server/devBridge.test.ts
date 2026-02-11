import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAppServerDevBridge } from './devBridge.js'

const {
  createServerMock,
  httpAddressMock,
  httpCloseMock,
  httpListenMock,
  httpOffMock,
  httpOnceMock,
  runAppServerMock,
  wsCtorMock,
  wsServerCloseMock,
  getConnectionHandler,
  setConnectionHandler,
  resetState,
  readInputBuffer,
  readRunAppServerArgs,
} = vi.hoisted(() => {
  let connectionHandler: ((socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) | null = null
  let inputBuffer = ''
  let runAppServerArgs: any | null = null

  const httpAddressMock = vi.fn(() => ({ address: '127.0.0.1', family: 'IPv4', port: 3777 }))
  const httpCloseMock = vi.fn((cb?: () => void) => cb?.())
  const httpListenMock = vi.fn((port: number, host: string, cb?: () => void) => cb?.())
  const httpOffMock = vi.fn()
  const httpOnceMock = vi.fn()

  const createServerMock = vi.fn(() => ({
    address: httpAddressMock,
    close: httpCloseMock,
    listen: httpListenMock,
    off: httpOffMock,
    once: httpOnceMock,
  }))

  const wsServerCloseMock = vi.fn((cb?: () => void) => cb?.())
  const wsCtorMock = vi.fn()

  const runAppServerMock = vi.fn(async (args: any) => {
    runAppServerArgs = args
    args.input?.on('data', (chunk: Buffer | string) => {
      inputBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })
    await new Promise<void>((resolve) => {
      args.input?.once('end', () => resolve())
    })
  })

  const resetState = () => {
    connectionHandler = null
    inputBuffer = ''
    runAppServerArgs = null
  }

  return {
    createServerMock,
    httpAddressMock,
    httpCloseMock,
    httpListenMock,
    httpOffMock,
    httpOnceMock,
    runAppServerMock,
    wsCtorMock,
    wsServerCloseMock,
    getConnectionHandler: () => connectionHandler,
    setConnectionHandler: (handler: (socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) => {
      connectionHandler = handler
    },
    resetState,
    readInputBuffer: () => inputBuffer,
    readRunAppServerArgs: () => runAppServerArgs,
  }
})

vi.mock('node:http', () => ({
  createServer: createServerMock,
}))

vi.mock('ws', () => {
  const WebSocket = { OPEN: 1 }

  class WebSocketServer {
    constructor(opts: any) {
      wsCtorMock(opts)
    }
    on(event: string, handler: (socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) {
      if (event === 'connection') {
        setConnectionHandler(handler)
      }
    }
    close(cb?: () => void) {
      wsServerCloseMock()
      cb?.()
    }
  }

  return { WebSocket, WebSocketServer }
})

vi.mock('./index.js', () => ({
  runAppServer: runAppServerMock,
}))

type MockSocket = {
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: (event: string, handler: (...args: any[]) => void) => void
  emitMessage: (raw: string | Buffer) => void
}

function createMockSocket(): MockSocket {
  const listeners = new Map<string, Array<(...args: any[]) => void>>()
  const on = (event: string, handler: (...args: any[]) => void) => {
    const list = listeners.get(event) ?? []
    list.push(handler)
    listeners.set(event, list)
  }
  const emit = (event: string, ...args: any[]) => {
    for (const handler of listeners.get(event) ?? []) handler(...args)
  }

  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => emit('close')),
    on,
    emitMessage: (raw) => emit('message', raw),
  }
}

afterEach(() => {
  resetState()
  vi.clearAllMocks()
})

describe('startAppServerDevBridge', () => {
  it('bridges websocket messages with app-server stdio streams', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    expect(typeof onConnection).toBe('function')

    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","method":"initialized"}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readInputBuffer()).toBe(
      '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","method":"initialized"}\n',
    )

    const runArgs = readRunAppServerArgs()
    expect(runArgs).toBeTruthy()
    runArgs.output.write('{"jsonrpc":"2.0","id":99,"result":{"ok":true}}\n')
    expect(socket.send).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":99,"result":{"ok":true}}')

    expect(bridge.url).toBe('ws://127.0.0.1:3777')
    await bridge.close()

    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(wsServerCloseMock).toHaveBeenCalledTimes(1)
    expect(httpCloseMock).toHaveBeenCalledTimes(1)
  })

  it('handles bridge/readDiff locally without forwarding to app-server input', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":42,"method":"bridge/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)

    expect(readInputBuffer()).toBe('')
    expect(socket.send).toHaveBeenCalled()
    const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(payload.id).toBe(42)
    expect(payload.result).toBeTruthy()
    expect(Array.isArray(payload.result.files)).toBe(true)

    await bridge.close()
  })

  it('rejects websocket connection when auth token does not match', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: { authToken: 'secret-token' },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=wrong-token', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Unauthorized')

    await bridge.close()
  })

  it('rejects websocket connection when origin is not allowed', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: {
        authToken: 'secret-token',
        allowedOrigins: ['http://localhost:3781'],
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=secret-token', headers: { origin: 'http://evil.invalid' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Forbidden origin')

    await bridge.close()
  })

  it('accepts websocket connection when token and origin are valid', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: {
        authToken: 'secret-token',
        allowedOrigins: ['http://localhost:3781'],
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=secret-token', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('{"jsonrpc":"2.0","id":1}\n')
    expect(socket.close).not.toHaveBeenCalledWith(1008, expect.anything())

    await bridge.close()
  })

  it('rejects when httpServer.listen throws synchronously', async () => {
    httpListenMock.mockImplementationOnce(() => {
      throw new Error('listen boom')
    })

    await expect(startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })).rejects.toThrow('listen boom')
    expect(runAppServerMock).not.toHaveBeenCalled()
    expect(httpOffMock).toHaveBeenCalled()
  })
})
async function waitFor(condition: () => boolean, timeoutMs = 1200): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for condition')
}
