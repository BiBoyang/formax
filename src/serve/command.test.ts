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
})
