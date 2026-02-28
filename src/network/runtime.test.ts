import { describe, expect, it } from 'vitest'
import {
  authorizeBridgeConnection,
  buildHttpUrl,
  buildLocalUiAllowedOrigins,
  buildWsUrl,
  createBridgeAuthToken,
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
    expect(formatHostForUrl('   ')).toBe('')
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
    expect(displayHostForLogs(' example.com ')).toBe('example.com')
  })

  it('decodes request pathname and rejects malformed urls', () => {
    expect(decodeRequestPathname('/foo%20bar')).toEqual({ ok: true, pathname: '/foo bar' })
    expect(decodeRequestPathname(undefined)).toEqual({ ok: true, pathname: '/' })
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

  it('authorizes with non-bearer authorization header and handles malformed request urls', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/',
        originHeader: 'http://localhost:3781',
        authorizationHeader: 'secret',
        security: { authToken: 'secret', allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: true })

    expect(
      authorizeBridgeConnection({
        requestUrl: 'http://%',
        originHeader: undefined,
        authorizationHeader: undefined,
        security: { authToken: 'secret' },
      }),
    ).toEqual({ ok: false, reason: 'Unauthorized' })
  })

  it('ignores invalid allowed origins entries', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=secret',
        originHeader: undefined,
        authorizationHeader: undefined,
        security: { authToken: 'secret', allowedOrigins: [':::'] },
      }),
    ).toEqual({ ok: true })
  })

  it('handles missing auth token config and whitespace auth header', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/',
        originHeader: 'http://localhost:3781',
        authorizationHeader: '   ',
        security: { allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: true })
  })

  it('allows requests when security options are omitted', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/',
        originHeader: undefined,
        authorizationHeader: undefined,
        security: undefined,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects when token is missing/blank in query and authorization header', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: undefined,
        originHeader: undefined,
        authorizationHeader: 'Bearer   ',
        security: { authToken: 'secret' },
      }),
    ).toEqual({ ok: false, reason: 'Unauthorized' })

    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=%20%20',
        originHeader: undefined,
        authorizationHeader: '   ',
        security: { authToken: 'secret' },
      }),
    ).toEqual({ ok: false, reason: 'Unauthorized' })
  })

  it('rejects when allowed origins require a valid origin header', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/',
        originHeader: undefined,
        authorizationHeader: undefined,
        security: { allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: false, reason: 'Forbidden origin' })
  })

  it('creates random bridge auth tokens', () => {
    const token = createBridgeAuthToken()
    expect(token).toMatch(/^[a-f0-9]{48}$/)
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

  it('skips wildcard/invalid custom hosts when building local UI allowed origins', () => {
    const wildcardOrigins = buildLocalUiAllowedOrigins('0.0.0.0', 3781)
    expect(wildcardOrigins).not.toContain('http://0.0.0.0:3781')

    const invalidOrigins = buildLocalUiAllowedOrigins(':::', 3781)
    expect(invalidOrigins).toContain('http://localhost:3781')
  })

  it('rejects origin headers that parse but have no host component', () => {
    expect(
      authorizeBridgeConnection({
        requestUrl: '/?token=secret',
        originHeader: 'mailto:test@example.com',
        authorizationHeader: undefined,
        security: { authToken: 'secret', allowedOrigins: ['http://localhost:3781'] },
      }),
    ).toEqual({ ok: false, reason: 'Forbidden origin' })
  })
})
