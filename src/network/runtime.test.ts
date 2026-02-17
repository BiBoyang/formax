import { describe, expect, it } from 'vitest'
import {
  authorizeBridgeConnection,
  buildHttpUrl,
  buildLocalUiAllowedOrigins,
  buildWsUrl,
  decodeRequestPathname,
  displayHostForLogs,
  evaluateBridgeRateLimit,
  formatHostForUrl,
  parseTcpPort,
} from './runtime.js'

describe('network runtime helpers', () => {
  it('parses valid TCP port values', () => {
    expect(parseTcpPort('3781', '--ui-port')).toBe(3781)
    expect(parseTcpPort(' 3777 ', '--bridge-port')).toBe(3777)
  })

  it('rejects invalid TCP port values', () => {
    expect(() => parseTcpPort('abc', '--ui-port')).toThrow('Invalid --ui-port')
    expect(() => parseTcpPort('1.5', '--ui-port')).toThrow('Invalid --ui-port')
    expect(() => parseTcpPort('0', '--ui-port')).toThrow('Invalid --ui-port')
    expect(() => parseTcpPort('65536', '--ui-port')).toThrow('Invalid --ui-port')
  })

  it('formats IPv6 hosts for URL usage', () => {
    expect(formatHostForUrl('127.0.0.1')).toBe('127.0.0.1')
    expect(formatHostForUrl('::1')).toBe('[::1]')
    expect(formatHostForUrl('[::1]')).toBe('[::1]')
    expect(buildHttpUrl('::1', 3781)).toBe('http://[::1]:3781')
    expect(buildWsUrl('::1', 3777)).toBe('ws://[::1]:3777')
    expect(buildWsUrl('::1', 3777, true)).toBe('wss://[::1]:3777')
  })

  it('normalizes log hosts for wildcard listeners', () => {
    expect(displayHostForLogs('0.0.0.0')).toBe('127.0.0.1')
    expect(displayHostForLogs('::')).toBe('[::1]')
  })

  it('decodes request pathname and rejects malformed urls', () => {
    expect(decodeRequestPathname('/foo%20bar')).toEqual({ ok: true, pathname: '/foo bar' })
    const malformed = decodeRequestPathname('/%E0%A4%A')
    expect(malformed.ok).toBe(false)
    if (malformed.ok === true) return
    expect(malformed.statusCode).toBe(400)
  })

  it('authorizes bridge connection by token and origin', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=secret',
        originHeader: 'http://localhost:3781',
        authorizationHeader: undefined,
        security: { authToken: 'secret', allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: true })

    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=wrong',
        originHeader: 'http://localhost:3781',
        authorizationHeader: undefined,
        security: { authToken: 'secret' },
      }),
    ).toEqual({ ok: false, reason: 'Unauthorized' })

    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=secret',
        originHeader: 'http://evil.invalid',
        authorizationHeader: undefined,
        security: { authToken: 'secret', allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: false, reason: 'Forbidden origin' })
  })

  it('authorizes bridge connection using authorization header token', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/',
        originHeader: 'http://localhost:3781',
        authorizationHeader: 'Bearer secret',
        security: { authToken: 'secret', allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: true })
  })

  it('enforces bridge rate limit in fixed windows', () => {
    const options = { windowMs: 1000, maxMessages: 2 }
    let state = null
    let decision = evaluateBridgeRateLimit({ state, nowMs: 100, options })
    expect(decision.allowed).toBe(true)
    state = decision.state

    decision = evaluateBridgeRateLimit({ state, nowMs: 200, options })
    expect(decision.allowed).toBe(true)
    state = decision.state

    decision = evaluateBridgeRateLimit({ state, nowMs: 300, options })
    expect(decision.allowed).toBe(false)

    decision = evaluateBridgeRateLimit({ state: decision.state, nowMs: 1300, options })
    expect(decision.allowed).toBe(true)
  })

  it('builds local UI allowed origins with loopback defaults', () => {
    const origins = buildLocalUiAllowedOrigins('127.0.0.1', 3781)
    expect(origins).toContain('http://127.0.0.1:3781')
    expect(origins).toContain('http://localhost:3781')
    expect(origins).toContain('http://[::1]:3781')
  })
})
