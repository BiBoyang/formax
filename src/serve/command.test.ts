import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SERVE_HOST,
  DEFAULT_SERVE_PORT,
  formatServeCommandHelp,
  parseServeCommandArgs,
} from './command.js'
import * as runtime from '../network/runtime.js'

describe('parseServeCommandArgs', () => {
  it('returns defaults for empty args', () => {
    const parsed = parseServeCommandArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options).toEqual({
      host: DEFAULT_SERVE_HOST,
      port: DEFAULT_SERVE_PORT,
      allowedOrigins: [],
    })
  })

  it('parses custom host, port, token and allowed origins', () => {
    const parsed = parseServeCommandArgs([
      '--host',
      '0.0.0.0',
      '--port',
      '4088',
      '--token',
      'abc123',
      '--allow-origin',
      'http://localhost:5173',
      '--allow-origin',
      'https://example.com:444',
    ])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options).toEqual({
      host: '0.0.0.0',
      port: 4088,
      token: 'abc123',
      allowedOrigins: ['http://localhost:5173', 'https://example.com:444'],
    })
  })

  it('dedupes allowed origins', () => {
    const parsed = parseServeCommandArgs([
      '--allow-origin',
      'http://localhost:5173',
      '--allow-origin',
      'http://localhost:5173',
    ])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options.allowedOrigins).toEqual(['http://localhost:5173'])
  })

  it('returns error for invalid port', () => {
    const parsed = parseServeCommandArgs(['--port', 'abc'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok === true) return
    expect(parsed.message).toContain('Invalid --port')
  })

  it('returns error for invalid origin', () => {
    const parsed = parseServeCommandArgs(['--allow-origin', 'not-a-url'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok === true) return
    expect(parsed.message).toContain('Invalid --allow-origin')
  })

  it('requires token for wildcard host', () => {
    const parsed = parseServeCommandArgs(['--host', '0.0.0.0'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok === true) return
    expect(parsed.message).toContain('without --token')
  })

  it('accepts wildcard host with token', () => {
    const parsed = parseServeCommandArgs(['--host', '0.0.0.0', '--token', 'secret'])
    expect(parsed.ok).toBe(true)
  })

  it('parses tls, rate-limit and audit options', () => {
    const parsed = parseServeCommandArgs([
      '--token',
      'secret',
      '--tls-cert',
      'cert.pem',
      '--tls-key',
      'key.pem',
      '--rate-limit-window-ms',
      '1000',
      '--rate-limit-max-messages',
      '20',
      '--audit-log',
      '/tmp/formax-audit.ndjson',
    ])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.options.tlsCertFile).toBe('cert.pem')
    expect(parsed.options.tlsKeyFile).toBe('key.pem')
    expect(parsed.options.rateLimitWindowMs).toBe(1000)
    expect(parsed.options.rateLimitMaxMessages).toBe(20)
    expect(parsed.options.auditLogFile).toBe('/tmp/formax-audit.ndjson')
  })

  it('requires complete tls pair', () => {
    const certOnly = parseServeCommandArgs(['--tls-cert', 'cert.pem'])
    expect(certOnly.ok).toBe(false)
    if (certOnly.ok === true) return
    expect(certOnly.message).toContain('--tls-cert and --tls-key')
  })

  it('requires complete rate-limit pair', () => {
    const windowOnly = parseServeCommandArgs(['--rate-limit-window-ms', '1000'])
    expect(windowOnly.ok).toBe(false)
    if (windowOnly.ok === true) return
    expect(windowOnly.message).toContain('--rate-limit-window-ms and --rate-limit-max-messages')
  })

  it('returns help sentinel for --help and -h', () => {
    const long = parseServeCommandArgs(['--help'])
    expect(long).toEqual({ ok: false, message: '__HELP__' })

    const short = parseServeCommandArgs(['-h'])
    expect(short).toEqual({ ok: false, message: '__HELP__' })
  })

  it('returns errors for missing option values and unknown args', () => {
    const missingHost = parseServeCommandArgs(['--host'])
    expect(missingHost.ok).toBe(false)

    const missingPort = parseServeCommandArgs(['--port'])
    expect(missingPort.ok).toBe(false)

    const missingToken = parseServeCommandArgs(['--token'])
    expect(missingToken.ok).toBe(false)

    const missingOrigin = parseServeCommandArgs(['--allow-origin'])
    expect(missingOrigin.ok).toBe(false)

    const missingTlsCert = parseServeCommandArgs(['--tls-cert'])
    expect(missingTlsCert.ok).toBe(false)

    const missingTlsKey = parseServeCommandArgs(['--tls-key'])
    expect(missingTlsKey.ok).toBe(false)

    const missingWindow = parseServeCommandArgs(['--rate-limit-window-ms'])
    expect(missingWindow.ok).toBe(false)

    const missingMax = parseServeCommandArgs(['--rate-limit-max-messages'])
    expect(missingMax.ok).toBe(false)

    const missingAudit = parseServeCommandArgs(['--audit-log'])
    expect(missingAudit.ok).toBe(false)

    const unknown = parseServeCommandArgs(['--wat'])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.message).toContain('Unknown argument')
  })

  it('validates origin protocol and non-empty token/tls/audit strings', () => {
    const ftpOrigin = parseServeCommandArgs(['--allow-origin', 'ftp://example.com'])
    expect(ftpOrigin.ok).toBe(false)

    const blankOrigin = parseServeCommandArgs(['--allow-origin', '   '])
    expect(blankOrigin.ok).toBe(false)

    const emptyToken = parseServeCommandArgs(['--token', '   '])
    expect(emptyToken.ok).toBe(false)

    const emptyCert = parseServeCommandArgs(['--tls-cert', '   '])
    expect(emptyCert.ok).toBe(false)

    const emptyKey = parseServeCommandArgs(['--tls-key', '   '])
    expect(emptyKey.ok).toBe(false)

    const emptyAudit = parseServeCommandArgs(['--audit-log', '   '])
    expect(emptyAudit.ok).toBe(false)
  })

  it('validates rate-limit bounds and wildcard :: host token requirement', () => {
    const lowWindow = parseServeCommandArgs(['--rate-limit-window-ms', '99'])
    expect(lowWindow.ok).toBe(false)

    const highMessages = parseServeCommandArgs(['--rate-limit-max-messages', '100001'])
    expect(highMessages.ok).toBe(false)

    const remoteNoToken = parseServeCommandArgs(['--host', '::'])
    expect(remoteNoToken.ok).toBe(false)
  })

  it('stringifies non-Error throw values from parser', () => {
    const spy = vi.spyOn(runtime, 'parseTcpPort').mockImplementation(() => {
      throw 'boom'
    })
    const parsed = parseServeCommandArgs(['--port', '3333'])
    expect(parsed).toEqual({ ok: false, message: 'boom' })
    spy.mockRestore()
  })
})

describe('formatServeCommandHelp', () => {
  it('returns serve help text', () => {
    const text = formatServeCommandHelp()
    expect(text).toContain('Formax Serve')
    expect(text).toContain('Usage:')
    expect(text).toContain('--allow-origin')
  })
})
