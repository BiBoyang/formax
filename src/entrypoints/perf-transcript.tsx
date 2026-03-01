#!/usr/bin/env node

/**
 * Perf Transcript Entry Point
 *
 * Manual perf harness for REPL transcript rendering.
 * Run with: bun run perf:transcript
 */

import { clearTerminal } from '../shared/utils/terminal.js'
import { renderTranscriptPerfEntry } from '../services/runtimeUiBridge.js'

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

  renderTranscriptPerfEntry({
    count,
    onExit: () => {
      process.exit(0)
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
