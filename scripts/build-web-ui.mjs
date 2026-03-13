#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..')
  const webRoot = path.join(repoRoot, 'packages', 'web-reference-react')
  const webDist = path.join(webRoot, 'dist')
  const outDir = path.join(repoRoot, 'dist', 'web')
  const bunCmd = process.platform === 'win32' ? 'bun.exe' : 'bun'

  // Dependencies are managed by root workspace install.
  run(bunCmd, ['run', 'build'], webRoot)

  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(path.dirname(outDir), { recursive: true })
  await fs.cp(webDist, outDir, { recursive: true, force: true })

  process.stdout.write(`[formax] copied web bundle to ${outDir}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
