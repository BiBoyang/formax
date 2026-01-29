#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const repoRoot = path.resolve(__dirname, '..')
const distCli = path.join(repoRoot, 'dist', 'cli.js')

const args = process.argv.slice(2)

if (!fs.existsSync(distCli)) {
  console.error('[formax] Could not find bundled CLI.')
  console.error(`- dist: ${distCli}`)
  console.error('[formax] Reinstall the package or rebuild (dev only).')
  process.exit(1)
}

const child = spawn(process.execPath, [distCli, ...args], { stdio: 'inherit' })
wireChildProcess(child)

function wireChildProcess(child) {
  const signalsToForward = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const signalHandlers = new Map()
  for (const signal of signalsToForward) {
    const handler = () => {
      child.kill(signal)
    }
    signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }

  child.once('error', (err) => {
    console.error('[formax] Failed to start:', err)
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    for (const [s, handler] of signalHandlers.entries()) {
      process.off(s, handler)
    }
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}
