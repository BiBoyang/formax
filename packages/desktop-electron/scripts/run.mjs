#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_UI_PORT = 3781
const DEFAULT_BRIDGE_PORT = 3777
const DEFAULT_START_URL = `http://${DEFAULT_HOST}:${DEFAULT_UI_PORT}`

const UI_WAIT_TIMEOUT_MS = 30_000
const UI_WAIT_POLL_MS = 250
const PROCESS_KILL_GRACE_MS = 4_000

function parseMode(argv) {
  let mode = null

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--mode') {
      const value = argv[i + 1]
      if (!value) throw new Error('Missing value for --mode')
      mode = value
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/run.mjs --mode <dev|debug|preview>',
          '',
          'Modes:',
          '  dev     - start app-server:web-reference + Electron',
          '  debug   - same as dev, plus main inspector and renderer DevTools',
          '  preview - start dist/cli.js web + Electron',
        ].join('\n') + '\n',
      )
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  if (mode !== 'dev' && mode !== 'debug' && mode !== 'preview') {
    throw new Error('Invalid --mode: expected one of dev|debug|preview')
  }

  return mode
}

function normalizeHostname(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

function isLoopbackHost(host) {
  const normalized = normalizeHostname(String(host || '').trim()).toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function resolveStartUrl() {
  const fromEnv = process.env.FORMAX_ELECTRON_START_URL
  if (!fromEnv || !fromEnv.trim()) {
    return {
      startUrl: DEFAULT_START_URL,
      host: DEFAULT_HOST,
      uiPort: DEFAULT_UI_PORT,
    }
  }

  try {
    const parsed = new URL(fromEnv)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`)
    }

    const host = normalizeHostname(parsed.hostname || DEFAULT_HOST)
    const parsedPort = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_UI_PORT
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error(`Invalid port: ${parsed.port}`)
    }

    return {
      startUrl: parsed.toString(),
      host,
      uiPort: parsedPort,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[formax-desktop] invalid FORMAX_ELECTRON_START_URL, fallback to default: ${message}\n`)
    return {
      startUrl: DEFAULT_START_URL,
      host: DEFAULT_HOST,
      uiPort: DEFAULT_UI_PORT,
    }
  }
}

function resolveBridgePort() {
  const raw = process.env.FORMAX_ELECTRON_BRIDGE_PORT
  if (!raw || !raw.trim()) return DEFAULT_BRIDGE_PORT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(`[formax-desktop] invalid FORMAX_ELECTRON_BRIDGE_PORT, fallback to default: ${raw}\n`)
    return DEFAULT_BRIDGE_PORT
  }
  return parsed
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForUiReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
      })
      if (response.status >= 200 && response.status < 500) {
        return
      }
    } catch {
      // Keep polling.
    }

    await delay(UI_WAIT_POLL_MS)
  }

  throw new Error(`Timed out waiting for UI readiness at ${url} within ${timeoutMs}ms`)
}

function exists(filePath) {
  try {
    fs.accessSync(filePath)
    return true
  } catch {
    return false
  }
}

async function runCommand(command, args, cwd, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
      },
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const suffix = signal ? ` (signal=${signal})` : ''
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (code=${code ?? 'null'})${suffix}`))
    })
  })
}

async function ensurePreviewArtifacts(repoRoot) {
  const cliDist = path.join(repoRoot, 'dist', 'cli.js')
  const webDist = path.join(repoRoot, 'dist', 'web', 'index.html')

  if (exists(cliDist) && exists(webDist)) return

  process.stderr.write('[formax-desktop] preview assets missing, running build + build:web-ui\n')

  const bunCmd = process.platform === 'win32' ? 'bun.exe' : 'bun'
  await runCommand(bunCmd, ['run', 'build'], repoRoot)
  await runCommand(bunCmd, ['run', 'build:web-ui'], repoRoot)
}

function terminateProcess(child) {
  if (!child || child.exitCode != null || child.killed) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const forceKillTimer = setTimeout(() => {
      if (child.exitCode == null && !child.killed) {
        child.kill('SIGKILL')
      }
      done()
    }, PROCESS_KILL_GRACE_MS)

    child.once('exit', () => {
      clearTimeout(forceKillTimer)
      done()
    })

    child.kill('SIGTERM')
  })
}

function createRuntimeCommand(mode, repoRoot, host, uiPort, bridgePort) {
  const setupModeArgs = isLoopbackHost(host) ? ['--setup-mode', 'allow'] : []
  if (mode === 'preview') {
    return {
      command: 'node',
      args: [
        'dist/cli.js',
        'web',
        '--host',
        host,
        '--ui-port',
        String(uiPort),
        '--bridge-port',
        String(bridgePort),
        ...setupModeArgs,
      ],
      cwd: repoRoot,
    }
  }

  const bunCmd = process.platform === 'win32' ? 'bun.exe' : 'bun'
  return {
    command: bunCmd,
    args: [
      'run',
      'app-server:web-reference',
      '--',
      '--host',
      host,
      '--bridge-port',
      String(bridgePort),
      '--ui-port',
      String(uiPort),
      ...setupModeArgs,
    ],
    cwd: repoRoot,
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2))

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(scriptDir, '..')
  const repoRoot = path.resolve(appRoot, '..', '..')
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { startUrl, host, uiPort } = resolveStartUrl()
  const bridgePort = resolveBridgePort()

  if (mode === 'preview') {
    await ensurePreviewArtifacts(repoRoot)
  }

  const runtimeConfig = createRuntimeCommand(mode, repoRoot, host, uiPort, bridgePort)

  let runtimeChild = null
  let electronChild = null
  let shuttingDown = false

  const shutdown = async (exitCode) => {
    if (shuttingDown) return
    shuttingDown = true

    await Promise.allSettled([
      terminateProcess(electronChild),
      terminateProcess(runtimeChild),
    ])

    process.exit(exitCode)
  }

  process.once('SIGINT', () => {
    void shutdown(0)
  })
  process.once('SIGTERM', () => {
    void shutdown(0)
  })

  process.stderr.write(`[formax-desktop] mode=${mode}, start=${startUrl}\n`)

  runtimeChild = spawn(runtimeConfig.command, runtimeConfig.args, {
    cwd: runtimeConfig.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
    },
  })

  runtimeChild.once('error', (error) => {
    console.error(error)
    void shutdown(1)
  })

  runtimeChild.once('exit', (code, signal) => {
    if (shuttingDown) return
    const suffix = signal ? ` signal=${signal}` : ''
    process.stderr.write(`[formax-desktop] runtime exited unexpectedly (code=${code ?? 'null'}${suffix})\n`)
    void shutdown(code ?? 1)
  })

  try {
    await waitForUiReady(startUrl, UI_WAIT_TIMEOUT_MS)
  } catch (error) {
    console.error(error)
    await shutdown(1)
    return
  }

  const electronEnv = {
    ...process.env,
    FORMAX_ELECTRON_START_URL: startUrl,
    FORMAX_ELECTRON_BRIDGE_PORT: String(bridgePort),
    FORMAX_ELECTRON_MODE: mode,
    FORMAX_ELECTRON_OPEN_DEVTOOLS: mode === 'debug' ? '1' : '0',
    FORMAX_ELECTRON_SKIP_SETUP_PROBE:
      process.env.FORMAX_ELECTRON_SKIP_SETUP_PROBE ?? (mode === 'preview' ? '0' : '1'),
  }

  const electronScript = mode === 'debug' ? 'electron:start:debug' : 'electron:start'
  const electronArgs = ['run', electronScript]

  electronChild = spawn(npmCmd, electronArgs, {
    cwd: appRoot,
    stdio: 'inherit',
    env: electronEnv,
  })

  electronChild.once('error', (error) => {
    console.error(error)
    void shutdown(1)
  })

  electronChild.once('exit', (code, signal) => {
    if (shuttingDown) return
    const suffix = signal ? ` signal=${signal}` : ''
    process.stderr.write(`[formax-desktop] electron exited (code=${code ?? 'null'}${suffix})\n`)
    void shutdown(code ?? (signal ? 1 : 0))
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
