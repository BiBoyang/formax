#!/usr/bin/env node

/**
 * Perf Transcript Entry Point
 *
 * Manual perf harness for REPL transcript rendering.
 * Run with: bun run perf:transcript
 */

import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { TranscriptPerfScreen } from '../screens/perf/TranscriptPerfScreen.js'

async function main() {
  await clearTerminal()

  render(
    <TranscriptPerfScreen
      count={500}
      onExit={() => {
        process.exit(0)
      }}
    />,
    {
      exitOnCtrlC: false,
    },
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
