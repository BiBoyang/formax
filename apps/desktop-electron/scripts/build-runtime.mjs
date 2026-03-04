#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function getBunCommand() {
  return process.platform === 'win32' ? 'bun.exe' : 'bun'
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
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

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const appRoot = path.resolve(scriptDir, '..')
  const repoRoot = path.resolve(appRoot, '..', '..')
  const runtimeRoot = path.join(appRoot, 'runtime')
  const runtimeWebRoot = path.join(runtimeRoot, 'web')
  const runtimeScriptPath = path.join(runtimeRoot, 'cli.mjs')
  const cliDistPath = path.join(repoRoot, 'dist', 'cli.js')
  const webDistPath = path.join(repoRoot, 'dist', 'web')

  const bunCmd = getBunCommand()
  process.stderr.write('[formax-desktop] building root CLI bundle for packaged runtime\n')
  await run(bunCmd, ['run', 'build'], repoRoot)

  process.stderr.write('[formax-desktop] building web assets for packaged runtime\n')
  await run(bunCmd, ['run', 'build:web-ui'], repoRoot)

  process.stderr.write('[formax-desktop] preparing runtime artifacts for Electron\n')
  await fs.mkdir(runtimeRoot, { recursive: true })
  await fs.copyFile(cliDistPath, runtimeScriptPath)

  process.stderr.write('[formax-desktop] copying web static bundle into Electron runtime\n')
  await fs.rm(runtimeWebRoot, { recursive: true, force: true })
  await fs.cp(webDistPath, runtimeWebRoot, { recursive: true })
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
