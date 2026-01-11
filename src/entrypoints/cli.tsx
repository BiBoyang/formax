#!/usr/bin/env node

import 'dotenv/config'
import { dispatchCli } from '../cli/main.js'
import { createApp } from '../core/app/createApp.js'
import { runLegacyCli } from '../legacy/runLegacyCli.js'

async function main(): Promise<void> {
  const res = await dispatchCli(process.argv.slice(2))
  if (res.kind === 'handled') {
    if (res.stdout) process.stdout.write(res.stdout)
    if (res.stderr) process.stderr.write(res.stderr)
    process.exitCode = res.exitCode
    return
  }

  const app = createApp()
  await runLegacyCli({ app })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
