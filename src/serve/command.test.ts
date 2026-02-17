import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT, parseServeCommandArgs } from './command.js'

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
})
