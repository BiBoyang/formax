#!/usr/bin/env node

import 'dotenv/config'
import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { MyChatScreen } from '../screens/MyChatScreen.js'

async function main() {
  // Optional: clear screen for a clean chat view
  await clearTerminal()

  render(
    <MyChatScreen
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
