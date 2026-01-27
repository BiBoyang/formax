import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import {
  buildLogMessage,
  sendLogMessageToClients,
  stopConsoleLogger,
  startConsoleLogger,
  wsDebug,
  wsError,
  wsInfo,
  wsLog,
  wsWarn,
} from './consoleLogger'

const {
  createServerMock,
  httpCloseMock,
  httpListenMock,
  wssCloseMock,
  wssCtorMock,
  wsSendMock,
  getConnectionHandler,
  setConnectionHandler,
  resetConnectionHandler,
} = vi.hoisted(() => {
  let connectionHandler: ((ws: any) => void) | null = null

  const httpCloseMock = vi.fn()
  const httpListenMock = vi.fn((port: number, cb?: () => void) => {
    cb?.()
  })
  const createServerMock = vi.fn((_handler: any) => ({
    listen: httpListenMock,
    close: httpCloseMock,
  }))

  const wssCloseMock = vi.fn()
  const wssCtorMock = vi.fn()

  const wsSendMock = vi.fn()

  return {
    createServerMock,
    httpCloseMock,
    httpListenMock,
    wssCloseMock,
    wssCtorMock,
    wsSendMock,
    getConnectionHandler: () => connectionHandler,
    setConnectionHandler: (next: (ws: any) => void) => {
      connectionHandler = next
    },
    resetConnectionHandler: () => {
      connectionHandler = null
    },
  }
})

vi.mock('http', () => ({
  createServer: createServerMock,
}))

vi.mock('ws', () => {
  const WebSocket = { OPEN: 1, CLOSED: 3 }

  class WebSocketServer {
    constructor(opts: any) {
      wssCtorMock(opts)
    }
    on(event: string, handler: any) {
      if (event === 'connection') {
        setConnectionHandler(handler)
      }
    }
    close() {
      wssCloseMock()
    }
  }

  return { WebSocket, WebSocketServer }
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllTimers()
  stopConsoleLogger()
  resetConnectionHandler()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('consoleLogger', () => {
  it('ws* helpers are no-ops when the logger is not started', () => {
    expect(() => wsLog('a')).not.toThrow()
    expect(() => wsInfo('a')).not.toThrow()
    expect(() => wsWarn('a')).not.toThrow()
    expect(() => wsError('a')).not.toThrow()
    expect(() => wsDebug('a')).not.toThrow()
    expect(() => stopConsoleLogger()).not.toThrow()
  })
})

describe('buildLogMessage', () => {
  it('builds a structured payload with deterministic timestamp', () => {
    const now = new Date('2020-01-01T00:00:00.000Z')
    const msg = buildLogMessage('log', ['hello', { a: 1 }], now)

    expect(msg.type).toBe('log')
    expect(msg.timestamp).toBe('2020-01-01T00:00:00.000Z')
    expect(msg.args).toEqual(['hello', { a: 1 }])
    expect(msg.formatted).toContain('hello')
    expect(msg.formatted).toContain('"a": 1')
  })

  it('serializes functions and errors in args', () => {
    const now = new Date('2020-01-01T00:00:00.000Z')
    const err = new Error('boom')

    const msg = buildLogMessage('error', [() => {}, err], now)
    expect(msg.args[0]).toBe('[Function]')
    expect(msg.args[1]?.message).toBe('boom')
    expect(typeof msg.args[1]?.stack).toBe('string')
  })

  it('does not throw on circular inputs', () => {
    const now = new Date('2020-01-01T00:00:00.000Z')
    const circular: any = { a: 1 }
    circular.self = circular

    const msg = buildLogMessage('log', [circular], now)
    expect(typeof msg.args[0]).toBe('string')
    expect(typeof msg.formatted).toBe('string')
  })
})

describe('sendLogMessageToClients', () => {
  it('sends JSON only to OPEN clients', () => {
    const openClient = { readyState: WebSocket.OPEN, send: vi.fn() }
    const closedClient = { readyState: WebSocket.CLOSED, send: vi.fn() }

    const msg = buildLogMessage('info', ['x'], new Date('2020-01-01T00:00:00.000Z'))
    expect(() => sendLogMessageToClients([openClient, closedClient], msg)).not.toThrow()

    expect(openClient.send).toHaveBeenCalledTimes(1)
    expect(closedClient.send).toHaveBeenCalledTimes(0)

    const payload = JSON.parse(openClient.send.mock.calls[0]?.[0] ?? '{}')
    expect(payload).toMatchObject({ type: 'info', timestamp: '2020-01-01T00:00:00.000Z' })
    expect(payload.args).toEqual(['x'])
  })

  it('swallows send failures', () => {
    const badClient = { readyState: WebSocket.OPEN, send: vi.fn(() => { throw new Error('boom') }) }
    const msg = buildLogMessage('info', ['x'], new Date('2020-01-01T00:00:00.000Z'))
    expect(() => sendLogMessageToClients([badClient], msg)).not.toThrow()
  })
})

describe('startConsoleLogger/stopConsoleLogger', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('startConsoleLogger is idempotent (does not create multiple servers)', () => {
    startConsoleLogger(3333)
    startConsoleLogger(3333)

    expect(createServerMock).toHaveBeenCalledTimes(1)
    expect(wssCtorMock).toHaveBeenCalledTimes(1)
    expect(httpListenMock).toHaveBeenCalledTimes(1)
  })

  it('stopConsoleLogger is safe when not started', () => {
    expect(() => stopConsoleLogger()).not.toThrow()
  })

  it('stopConsoleLogger closes servers and disables wsLog sending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'))

    startConsoleLogger(3333)

    const onConnection = getConnectionHandler()
    expect(typeof onConnection).toBe('function')

    const wsClient = { readyState: WebSocket.OPEN, send: wsSendMock, on: vi.fn(), close: vi.fn() }
    ;(onConnection as any)(wsClient)

    wsLog('hello')
    expect(wsSendMock).toHaveBeenCalled()

    stopConsoleLogger()
    expect(httpCloseMock).toHaveBeenCalledTimes(1)
    expect(wssCloseMock).toHaveBeenCalledTimes(1)

    const callCountAfterStop = wsSendMock.mock.calls.length
    wsLog('after-stop')
    expect(wsSendMock.mock.calls.length).toBe(callCountAfterStop)
  })
})
