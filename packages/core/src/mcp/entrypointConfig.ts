import { parseMcpConfig, parseMcpConfigFromFormaxConfig, type ParseMcpConfigResult } from './config.js'
import type { McpConfig } from './types.js'

export type McpRuntimeEntrypoint = 'repl' | 'sdk' | 'app-server'

export type ResolveMcpConfigForEntrypointInput = {
  entrypoint: McpRuntimeEntrypoint
  persistedConfig?: unknown
  overlayConfig?: unknown
}

function emptyConfig(): McpConfig {
  return { servers: {} }
}

function parseOptionalOverlay(input: unknown): ParseMcpConfigResult {
  if (input === undefined) return { ok: true, config: emptyConfig() }
  return parseMcpConfig({ servers: normalizeSdkOverlayServerMap(input) })
}

function normalizeSdkOverlayServerMap(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const out: Record<string, unknown> = {}
  for (const [serverId, rawServer] of Object.entries(input as Record<string, unknown>)) {
    if (
      rawServer
      && typeof rawServer === 'object'
      && !Array.isArray(rawServer)
      && !('type' in rawServer)
      && typeof (rawServer as { command?: unknown }).command === 'string'
    ) {
      out[serverId] = { type: 'stdio', ...rawServer }
      continue
    }
    out[serverId] = rawServer
  }
  return out
}

export function resolveMcpConfigForEntrypoint(
  input: ResolveMcpConfigForEntrypointInput,
): ParseMcpConfigResult {
  if (input.entrypoint === 'app-server') return { ok: true, config: emptyConfig() }

  if (input.entrypoint === 'sdk') {
    return parseOptionalOverlay(input.overlayConfig)
  }

  return parseMcpConfigFromFormaxConfig(input.persistedConfig)
}
