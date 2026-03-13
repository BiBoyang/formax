import { parseTcpPort } from '../network/runtime.js'

export const DEFAULT_SERVE_HOST = '127.0.0.1'
export const DEFAULT_SERVE_PORT = 3777

export type ServeCommandOptions = {
  host: string
  port: number
  token?: string
  allowedOrigins: string[]
  tlsCertFile?: string
  tlsKeyFile?: string
  rateLimitWindowMs?: number
  rateLimitMaxMessages?: number
  auditLogFile?: string
}

type ParseServeCommandResult =
  | { ok: true; options: ServeCommandOptions }
  | { ok: false; message: string }

function parseAllowedOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Invalid --allow-origin: expected non-empty origin')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid --allow-origin: expected origin like http://localhost:5173')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
    throw new Error('Invalid --allow-origin: expected origin like http://localhost:5173')
  }
  return `${parsed.protocol}//${parsed.host}`.toLowerCase()
}

export function parseServeCommandArgs(args: string[]): ParseServeCommandResult {
  const options: ServeCommandOptions = {
    host: DEFAULT_SERVE_HOST,
    port: DEFAULT_SERVE_PORT,
    allowedOrigins: [],
  }
  const allowedOriginsSet = new Set<string>()

  try {
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i]
      if (token === '--host') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --host')
        options.host = value
        i += 1
        continue
      }
      if (token === '--port') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --port')
        options.port = parseTcpPort(value, '--port')
        i += 1
        continue
      }
      if (token === '--token') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --token')
        const trimmed = value.trim()
        if (!trimmed) throw new Error('Invalid --token: expected non-empty value')
        options.token = trimmed
        i += 1
        continue
      }
      if (token === '--allow-origin') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --allow-origin')
        const normalizedOrigin = parseAllowedOrigin(value)
        allowedOriginsSet.add(normalizedOrigin)
        i += 1
        continue
      }
      if (token === '--tls-cert') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --tls-cert')
        const trimmed = value.trim()
        if (!trimmed) throw new Error('Invalid --tls-cert: expected non-empty file path')
        options.tlsCertFile = trimmed
        i += 1
        continue
      }
      if (token === '--tls-key') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --tls-key')
        const trimmed = value.trim()
        if (!trimmed) throw new Error('Invalid --tls-key: expected non-empty file path')
        options.tlsKeyFile = trimmed
        i += 1
        continue
      }
      if (token === '--rate-limit-window-ms') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --rate-limit-window-ms')
        const parsed = Number(value.trim())
        if (!Number.isInteger(parsed) || parsed < 100 || parsed > 600000) {
          throw new Error('Invalid --rate-limit-window-ms: expected integer in [100, 600000]')
        }
        options.rateLimitWindowMs = parsed
        i += 1
        continue
      }
      if (token === '--rate-limit-max-messages') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --rate-limit-max-messages')
        const parsed = Number(value.trim())
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
          throw new Error('Invalid --rate-limit-max-messages: expected integer in [1, 100000]')
        }
        options.rateLimitMaxMessages = parsed
        i += 1
        continue
      }
      if (token === '--audit-log') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --audit-log')
        const trimmed = value.trim()
        if (!trimmed) throw new Error('Invalid --audit-log: expected non-empty file path')
        options.auditLogFile = trimmed
        i += 1
        continue
      }
      if (token === '--help' || token === '-h') {
        return { ok: false, message: '__HELP__' }
      }
      throw new Error(`Unknown argument: ${token}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }

  if ((options.tlsCertFile && !options.tlsKeyFile) || (!options.tlsCertFile && options.tlsKeyFile)) {
    return { ok: false, message: 'TLS requires both --tls-cert and --tls-key' }
  }

  if (
    (options.rateLimitWindowMs != null && options.rateLimitMaxMessages == null) ||
    (options.rateLimitWindowMs == null && options.rateLimitMaxMessages != null)
  ) {
    return {
      ok: false,
      message: 'Rate limit requires both --rate-limit-window-ms and --rate-limit-max-messages',
    }
  }

  const host = options.host.trim()
  const isRemoteHost = host === '0.0.0.0' || host === '::'
  if (isRemoteHost && !options.token) {
    return {
      ok: false,
      message: 'Refusing to expose on wildcard host without --token',
    }
  }

  options.allowedOrigins = [...allowedOriginsSet]
  return { ok: true, options }
}

export function formatServeCommandHelp(): string {
  return (
    `Formax Serve\n\n` +
    `Usage:\n` +
    `  formax serve [--host 127.0.0.1] [--port 3777] [--token <secret>] [--allow-origin <origin> ...]\n` +
    `              [--tls-cert <cert.pem> --tls-key <key.pem>]\n` +
    `              [--rate-limit-window-ms <ms> --rate-limit-max-messages <n>]\n` +
    `              [--audit-log <file>]\n\n` +
    `Description:\n` +
    `  Start local WebSocket bridge for formax app-server.\n` +
    `  Use this for browser/GUI clients that need a stable ws endpoint.\n\n` +
    `  Security notes:\n` +
    `  - Wildcard hosts (0.0.0.0 / ::) require --token.\n` +
    `  - Provide --tls-cert/--tls-key to serve wss://.\n\n` +
    `Examples:\n` +
    `  formax serve\n` +
    `  formax serve --host 0.0.0.0 --port 3777 --token my-secret\n` +
    `  formax serve --token my-secret --allow-origin http://localhost:5173\n` +
    `  formax serve --token my-secret --tls-cert cert.pem --tls-key key.pem\n`
  )
}
