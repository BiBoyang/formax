import { startAppServerDevBridge } from '../../app-server/devBridge.js'
import type { BridgeSecurityOptions } from '../network/runtime.js'
import { displayHostForLogs } from '../network/runtime.js'
import type { ServeCommandOptions } from '../cli/serveCommand.js'

export type ServeBridgeHandle = {
  url: string
  close: () => Promise<void>
}

function buildSecurityOptions(options: ServeCommandOptions): BridgeSecurityOptions | undefined {
  const security: BridgeSecurityOptions = {}
  if (options.token) security.authToken = options.token
  if (options.allowedOrigins.length > 0) security.allowedOrigins = [...options.allowedOrigins]
  if (!security.authToken && !security.allowedOrigins) return undefined
  return security
}

function buildRateLimitOptions(options: ServeCommandOptions):
  | { windowMs: number; maxMessages: number }
  | undefined {
  if (options.rateLimitWindowMs == null || options.rateLimitMaxMessages == null) return undefined
  return {
    windowMs: options.rateLimitWindowMs,
    maxMessages: options.rateLimitMaxMessages,
  }
}

export async function startServeBridge(options: ServeCommandOptions): Promise<ServeBridgeHandle> {
  const bridge = await startAppServerDevBridge({
    host: options.host,
    port: options.port,
    security: buildSecurityOptions(options),
    tls:
      options.tlsCertFile && options.tlsKeyFile
        ? {
            certFile: options.tlsCertFile,
            keyFile: options.tlsKeyFile,
          }
        : undefined,
    rateLimit: buildRateLimitOptions(options),
    auditLogFile: options.auditLogFile,
  })

  return {
    url: bridge.url,
    close: bridge.close,
  }
}

export async function runServe(options: ServeCommandOptions): Promise<void> {
  const bridge = await startServeBridge(options)

  const bridgeScheme = options.tlsCertFile && options.tlsKeyFile ? 'wss' : 'ws'
  const connectHost = displayHostForLogs(options.host)
  process.stderr.write(`[formax] serve bridge: ${bridgeScheme}://${connectHost}:${options.port}\n`)
  if (options.token) {
    process.stderr.write('[formax] websocket auth: token required (--token)\n')
  }
  if (options.allowedOrigins.length > 0) {
    process.stderr.write(`[formax] allowed origins: ${options.allowedOrigins.join(', ')}\n`)
  }
  if (options.rateLimitWindowMs != null && options.rateLimitMaxMessages != null) {
    process.stderr.write(
      `[formax] rate limit: ${options.rateLimitMaxMessages} messages / ${options.rateLimitWindowMs}ms per connection\n`,
    )
  }
  if (options.auditLogFile) {
    process.stderr.write(`[formax] audit log: ${options.auditLogFile}\n`)
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await bridge.close()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}
