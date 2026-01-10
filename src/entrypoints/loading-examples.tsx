#!/usr/bin/env node

/**
 * Loading Examples Entry Point
 *
 * Launches the LoadingExampleScreen for debugging the loading UI.
 * Run with: npm run loade
 */

import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { LoadingExampleScreen } from '../screens/LoadingExampleScreen.js'

async function main() {
  await clearTerminal()

  render(
    <LoadingExampleScreen
      onExit={() => {
        process.exit(0)
      }}
    />,
    {
      exitOnCtrlC: false,
    },
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

