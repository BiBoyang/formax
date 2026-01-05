#!/usr/bin/env node

/**
 * Tool Examples Entry Point
 * 
 * Launches the ToolExamplesScreen for debugging and testing tool UI components.
 * Run with: npm run tool-examples
 */

import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { ToolExamplesScreen } from '../screens/ToolExamplesScreen.js'

async function main() {
  // Clear screen for a clean view
  await clearTerminal()

  render(
    <ToolExamplesScreen
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
