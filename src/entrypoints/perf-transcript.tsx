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

function parseArgs(argv: string[]): { count: number } {
  const idx = argv.indexOf('--count')
  if (idx >= 0) {
    const raw = argv[idx + 1]
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n > 0) return { count: Math.floor(n) }
  }
  return { count: 50 }
}

async function main() {
  const { count } = parseArgs(process.argv.slice(2))
  await clearTerminal()

  render(
    <TranscriptPerfScreen
      count={count}
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
