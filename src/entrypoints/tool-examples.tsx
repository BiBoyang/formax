#!/usr/bin/env node

/**
 * Tool Examples Entry Point
 * 
 * Launches the ToolExamplesScreen for debugging and testing tool UI components.
 * Run with: bun run toole
 */

import { clearTerminal } from '../shared/utils/terminal.js'
import { renderToolExamplesEntry } from '../services/runtimeUiBridge.js'
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

  renderToolExamplesEntry({
    toolRegistry,
    onExit: () => {
      process.exit(0)
    },
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
