#!/usr/bin/env node

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAppServerDevBridge } from '../app-server/devBridge.js'
import { renderWebLogo } from '../runtime/web/logo.js'

type CliOptions = {
  host?: string
  bridgePort?: number
  uiPort?: number
  setupMode?: 'require-config' | 'allow'
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
    if (token === '--setup-mode') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --setup-mode')
      if (value !== 'require-config' && value !== 'allow') {
        throw new Error('Invalid --setup-mode: expected require-config or allow')
      }
      out.setupMode = value
      i += 1
      continue
    }
    if (token === '--allow-setup') {
      out.setupMode = 'allow'
      continue
    }
    if (token === '-h' || token === '--help') {
      process.stdout.write(
        [
          'Usage: formax-web-reference [--host 127.0.0.1] [--bridge-port 3777] [--ui-port 3781] [--setup-mode require-config|allow]',
          '',
          'Starts app-server WebSocket dev bridge and the React web reference client (Vite).',
          'Use --setup-mode allow when Electron dev should open setup before the main page.',
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
  const uiPort = args.uiPort ?? 3781

  const bridge = await startAppServerDevBridge({
    host,
    ...(args.bridgePort !== undefined ? { port: args.bridgePort } : {}),
    setupMode: args.setupMode ?? 'require-config',
  })

  const entrypointDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(entrypointDir, '..', '..', '..', '..')
  const webCwd = path.join(repoRoot, 'packages', 'web-reference-react')
  if (!existsSync(webCwd)) {
    throw new Error(
      `[formax] web reference workspace not found: ${webCwd} (expected packages/web-reference-react under repo root)`,
    )
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const web: ChildProcess = spawn(npmCmd, ['run', 'dev', '--', '--host', host, '--port', String(uiPort)], {
    cwd: webCwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_FORMAX_BRIDGE_URL: bridge.url,
      VITE_FORMAX_SETUP_MODE: args.setupMode ?? 'require-config',
    },
  })

  process.stderr.write(renderWebLogo())
  process.stderr.write(`[formax] app-server bridge: ${bridge.url}\n`)
  process.stderr.write(`[formax] web reference ui: http://${host}:${uiPort}\n`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true

    if (web.exitCode == null && !web.killed) {
      web.kill('SIGTERM')
    }

    await bridge.close()
  }

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })

  web.on('exit', (code, signal) => {
    if (shuttingDown) return
    void shutdown().finally(() => {
      if (code != null) process.exit(code)
      process.exit(signal ? 1 : 0)
    })
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
