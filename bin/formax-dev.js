#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const repoRoot = path.resolve(__dirname, '..')
const distCli = path.join(repoRoot, 'dist', 'cli.js')
const tsEntry = path.join(repoRoot, 'src', 'entrypoints', 'cli.tsx')

const args = process.argv.slice(2)

if (fs.existsSync(distCli)) {
  const child = spawn(process.execPath, [distCli, ...args], { stdio: 'inherit' })
  wireChildProcess(child)
} else if (!fs.existsSync(tsEntry)) {
  console.error('[formax] Could not find CLI entrypoint.')
  console.error(`- dist: ${distCli}`)
  console.error(`- src:  ${tsEntry}`)
  console.error('[formax] Install dependencies and/or build the CLI first.')
  process.exit(1)
} else {
  const tsxCli = resolveTsxCli()
  const child = spawn(process.execPath, [tsxCli, tsEntry, ...args], { stdio: 'inherit' })
  wireChildProcess(child)
}

function resolveTsxCli() {
  const candidates = []
  try {
    candidates.push(require.resolve('tsx/cli'))
  } catch {
    // ignore
  }
  try {
    const tsxPkgJson = require.resolve('tsx/package.json')
    candidates.push(path.join(path.dirname(tsxPkgJson), 'dist', 'cli.mjs'))
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }

  console.error(
    [
      '[formax] Could not resolve tsx CLI (required to run the TypeScript entrypoint).',
      'Install dependencies first (e.g. `bun install` or `npm install`).',
    ].join('\n'),
  )
  process.exit(1)
}

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

