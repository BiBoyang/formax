import { startAppServerDevBridge } from '../app-server/devBridge.js'
import type { BridgeSecurityOptions } from '../network/runtime.js'
import { displayHostForLogs } from '../network/runtime.js'
import type { ServeCommandOptions } from './command.js'

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

export async function startServeBridge(options: ServeCommandOptions): Promise<ServeBridgeHandle> {
  const bridge = await startAppServerDevBridge({
    host: options.host,
    port: options.port,
    security: buildSecurityOptions(options),
  })

  return {
    url: bridge.url,
    close: bridge.close,
  }
}

export async function runServe(options: ServeCommandOptions): Promise<void> {
  const bridge = await startServeBridge(options)

  const connectHost = displayHostForLogs(options.host)
  process.stderr.write(`[formax] serve bridge: ws://${connectHost}:${options.port}\n`)
  if (options.token) {
    process.stderr.write('[formax] websocket auth: token required (--token)\n')
  }
  if (options.allowedOrigins.length > 0) {
    process.stderr.write(`[formax] allowed origins: ${options.allowedOrigins.join(', ')}\n`)
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
