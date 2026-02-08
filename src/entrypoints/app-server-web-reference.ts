#!/usr/bin/env node

import 'dotenv/config'
import { startAppServerDevBridge } from '../app-server/devBridge.js'
import { startWebReferenceServer } from '../app-server/web-reference/server.js'

type CliOptions = {
  host?: string
  bridgePort?: number
  uiPort?: number
}

function parsePort(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}: expected non-negative integer`)
  }
  return parsed
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--host') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --host')
      out.host = value
      i += 1
      continue
    }
    if (token === '--bridge-port') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --bridge-port')
      out.bridgePort = parsePort(value, '--bridge-port')
      i += 1
      continue
    }
    if (token === '--ui-port') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --ui-port')
      out.uiPort = parsePort(value, '--ui-port')
      i += 1
      continue
    }
    if (token === '-h' || token === '--help') {
      process.stdout.write(
        [
          'Usage: formax-web-reference [--host 127.0.0.1] [--bridge-port 3777] [--ui-port 3780]',
          '',
          'Starts app-server WebSocket dev bridge and static web reference UI.',
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
  const host = args.host ?? '127.0.0.1'

  const bridge = await startAppServerDevBridge({
    host,
    ...(args.bridgePort !== undefined ? { port: args.bridgePort } : {}),
  })

  const web = await startWebReferenceServer({
    host,
    ...(args.uiPort !== undefined ? { port: args.uiPort } : {}),
    bridgeUrl: bridge.url,
  })

  process.stderr.write(`[formax] app-server bridge: ${bridge.url}\n`)
  process.stderr.write(`[formax] web reference ui: ${web.url}\n`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await Promise.all([web.close(), bridge.close()])
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
