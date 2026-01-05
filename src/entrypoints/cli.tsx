#!/usr/bin/env node

import 'dotenv/config'
import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { MyChatScreen } from '../screens/MyChatScreen.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'

async function main() {
  // 启动控制台日志服务器（可选，通过环境变量控制）
  const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'
  if (enableLogger) {
    const port = parseInt(process.env.CONSOLE_LOGGER_PORT || '3001', 10)
    startConsoleLogger(port)
  }

  // Optional: clear screen for a clean chat view
  await clearTerminal()

  render(
    <MyChatScreen
      onExit={() => {
        stopConsoleLogger()
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
