import { describe, expect, it } from 'vitest'
import {
  listEnabledMcpServers,
  parseMcpConfig,
  parseMcpConfigFromFormaxConfig,
} from './config.js'

describe('MCP config parsing', () => {
  it('accepts the Phase 1A stdio and http schema with enabled defaulting true', () => {
    const result = parseMcpConfig({
      servers: {
        fs: { type: 'stdio', command: 'mcp-files', args: ['--cwd', '.'], env: { API_KEY: 'x' } },
        jira: {
          type: 'http',
          url: 'https://mcp.example.com/session',
          headers: { Authorization: 'Bearer token', 'x-dynamic-key': 'ok' },
          timeoutMs: 10_000,
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      config: {
        servers: {
          fs: { type: 'stdio', command: 'mcp-files', args: ['--cwd', '.'], env: { API_KEY: 'x' }, enabled: true },
          jira: {
            type: 'http',
            url: 'https://mcp.example.com/session',
            headers: { Authorization: 'Bearer token', 'x-dynamic-key': 'ok' },
            timeoutMs: 10_000,
            enabled: true,
          },
        },
      },
    })
  })

  it('rejects unsupported transports and loose config bags', () => {
    const sse = parseMcpConfig({ servers: { legacy: { type: 'sse', url: 'https://example.com/sse' } } })
    const looseHttp = parseMcpConfig({
      servers: { remote: { type: 'http', url: 'https://example.com/mcp', reconnect: true } },
    })
    const disabledAlias = parseMcpConfig({
      servers: { local: { type: 'stdio', command: 'server', disabled: true } },
    })

    expect(sse.ok).toBe(false)
    expect(looseHttp.ok).toBe(false)
    expect(disabledAlias.ok).toBe(false)
  })

  it('rejects non-http URL schemes for Streamable HTTP configs', () => {
    expect(parseMcpConfig({
      servers: {
        local: { type: 'http', url: 'file:///tmp/mcp.sock' },
      },
    }).ok).toBe(false)
  })

  it('normalizes server ids and rejects ids that collide after normalization', () => {
    expect(parseMcpConfig({
      servers: {
        'team/github': { type: 'stdio', command: 'github-mcp' },
      },
    })).toEqual({
      ok: true,
      config: { servers: { team_github: { type: 'stdio', command: 'github-mcp', enabled: true } } },
    })

    const collision = parseMcpConfig({
      servers: {
        'team/github': { type: 'stdio', command: 'one' },
        'team github': { type: 'stdio', command: 'two' },
      },
    })

    expect(collision.ok).toBe(false)
    expect((collision as { ok: false; issues: string[] }).issues.join('\n')).toContain('collides')
  })

  it('extracts mcp config from the Formax config envelope only when present', () => {
    expect(parseMcpConfigFromFormaxConfig({ version: 1 })).toEqual({ ok: true, config: { servers: {} } })
    expect(parseMcpConfigFromFormaxConfig({
      version: 1,
      mcp: { servers: { local: { type: 'stdio', command: 'server', enabled: false } } },
    })).toEqual({
      ok: true,
      config: { servers: { local: { type: 'stdio', command: 'server', enabled: false } } },
    })
  })

  it('lists only enabled servers', () => {
    const parsed = parseMcpConfig({
      servers: {
        on: { type: 'stdio', command: 'on' },
        off: { type: 'http', url: 'https://example.com/mcp', enabled: false },
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(listEnabledMcpServers(parsed.config)).toEqual([
      ['on', { type: 'stdio', command: 'on', enabled: true }],
    ])
  })
})
