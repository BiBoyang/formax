#!/usr/bin/env node

import 'dotenv/config'
import { parseCliArgs } from '../cli/args.js'
import { dispatchCli } from '../cli/main.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const parsed = parseCliArgs(argv)
  if (parsed.flags.noColor) {
    process.env.NO_COLOR = '1'
    process.env.FORCE_COLOR = '0'
  }
  if (parsed.flags.resumeLast) {
    process.env.FORMAX_RESUME_LAST = '1'
  }

  const res = await dispatchCli(argv)
  if (res.kind === 'handled') {
    if (res.stdout) process.stdout.write(res.stdout)
    if (res.stderr) process.stderr.write(res.stderr)
    process.exitCode = res.exitCode
    return
  }

  if (res.kind === 'app-server') {
    const { runAppServer } = await import('../app-server/index.js')
    await runAppServer()
    return
  }

  if (res.kind === 'serve') {
    const { runServe } = await import('../serve/localServer.js')
    await runServe(res.options)
    return
  }

  if (res.kind === 'web') {
    const { runWebUi } = await import('../web/localUi.js')
    await runWebUi(res.options)
    return
  }

  const { createApp } = await import('../core/app/createApp.js')
  const { runLegacyCli } = await import('../legacy/runLegacyCli.js')
  const app = createApp()
  await runLegacyCli({ app })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
