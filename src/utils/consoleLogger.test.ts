import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import {
  buildLogMessage,
  sendLogMessageToClients,
  stopConsoleLogger,
  wsDebug,
  wsError,
  wsInfo,
  wsLog,
  wsWarn,
} from './consoleLogger'

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
