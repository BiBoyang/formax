#!/usr/bin/env node

/**
 * Loading Examples Entry Point
 *
 * Launches the LoadingExampleScreen for debugging the loading UI.
 * Run with: bun run loade
 */

import { clearTerminal } from '../shared/utils/terminal.js'
import { renderLoadingExamplesEntry } from '../services/runtimeUiBridge.js'

async function main() {
  await clearTerminal()

  renderLoadingExamplesEntry({
    onExit: () => {
      process.exit(0)
    },
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
