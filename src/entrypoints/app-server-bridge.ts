#!/usr/bin/env node

import 'dotenv/config'
import { startAppServerDevBridge } from '../app-server/devBridge.js'

type CliArgs = {
  host?: string
  port?: number
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--host') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --host')
      out.host = value
      i += 1
      continue
    }
    if (token === '--port') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --port')
      const parsed = Number.parseInt(value, 10)
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Invalid --port: expected non-negative integer')
      out.port = parsed
      i += 1
      continue
    }
    if (token === '-h' || token === '--help') {
      process.stdout.write(
        [
          'Usage: formax-app-server-bridge [--host 127.0.0.1] [--port 3777]',
          '',
          'Dev-only WebSocket bridge for `formax app-server` JSON-RPC.',
        ].join('\n') + '\n',
      )
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${token}`)
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const bridge = await startAppServerDevBridge({
    ...(args.host ? { host: args.host } : {}),
    ...(args.port !== undefined ? { port: args.port } : {}),
  })

  process.stderr.write(`[formax] app-server dev bridge listening on ${bridge.url}\n`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await bridge.close()
  }

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
