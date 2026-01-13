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
const entrypoint = path.join(repoRoot, 'src', 'entrypoints', 'cli.tsx')

if (!fs.existsSync(entrypoint)) {
  console.error(`[formax] Could not find CLI entrypoint at: ${entrypoint}`)
  process.exit(1)
}

const tsxCli = resolveTsxCli()

const child = spawn(process.execPath, [tsxCli, entrypoint, ...process.argv.slice(2)], { stdio: 'inherit' })
child.once('error', (err) => {
  console.error('[formax] Failed to start:', err)
  process.exit(1)
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})

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

