#!/usr/bin/env node

/**
 * Tool Examples Entry Point
 * 
 * Launches the ToolExamplesScreen for debugging and testing tool UI components.
 * Run with: npm run toole
 */

import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { ToolExamplesScreen } from '../screens/ToolExamplesScreen.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltinToolModules } from '../tools/modules/index.js'
import { TaskManager } from '../tools/runtime/taskManager.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'

async function main() {
  // Clear screen for a clean view
  await clearTerminal()

  const toolRegistry = new ToolRegistry()
  registerBuiltinToolModules(toolRegistry, {
    taskManager: new TaskManager(),
    userInput: createUserInputManager(),
    cwd: process.cwd(),
  })

  render(
    <InputScopeProvider>
      <ToolExamplesScreen
        toolRegistry={toolRegistry}
        onExit={() => {
          process.exit(0)
        }}
      />
    </InputScopeProvider>,
    {
      exitOnCtrlC: false,
    },
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
