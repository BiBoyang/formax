import { describe, expect, it } from 'vitest'
import { resolveMcpConfigForEntrypoint } from './entrypointConfig.js'

describe('MCP entrypoint config resolution', () => {
  const persistedConfig = {
    version: 1,
    mcp: {
      servers: {
        disk: { type: 'stdio', command: 'disk-server' },
      },
    },
  }

  it('lets REPL read persisted config and ignore explicit overlays', () => {
    expect(resolveMcpConfigForEntrypoint({
      entrypoint: 'repl',
      persistedConfig,
      overlayConfig: {
        servers: {
          disk: { type: 'stdio', command: 'overlay-server' },
          remote: { type: 'http', url: 'https://example.com/mcp' },
        },
      },
    })).toEqual({
      ok: true,
      config: {
        servers: {
          disk: { type: 'stdio', command: 'disk-server', enabled: true },
        },
      },
    })
  })

  it('keeps SDK overlay-only and ignores user/project persisted config', () => {
    expect(resolveMcpConfigForEntrypoint({
      entrypoint: 'sdk',
      persistedConfig,
      overlayConfig: {
        sdk: { command: 'sdk-server' },
      },
    })).toEqual({
      ok: true,
      config: { servers: { sdk: { type: 'stdio', command: 'sdk-server', enabled: true } } },
    })
  })

  it('treats a raw SDK server named servers as a server id, not an envelope', () => {
    expect(resolveMcpConfigForEntrypoint({
      entrypoint: 'sdk',
      overlayConfig: {
        servers: { type: 'stdio', command: 'servers-server' },
        other: { type: 'http', url: 'https://example.com/mcp' },
      },
    })).toEqual({
      ok: true,
      config: {
        servers: {
          servers: { type: 'stdio', command: 'servers-server', enabled: true },
          other: { type: 'http', url: 'https://example.com/mcp', enabled: true },
        },
      },
    })
  })

  it('keeps app-server Phase 1A on an explicit empty MCP overlay', () => {
    expect(resolveMcpConfigForEntrypoint({
      entrypoint: 'app-server',
      persistedConfig,
      overlayConfig: {
        servers: {
          ignored: { type: 'stdio', command: 'ignored' },
        },
      },
    })).toEqual({ ok: true, config: { servers: {} } })
  })
})
