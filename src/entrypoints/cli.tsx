#!/usr/bin/env node

import 'dotenv/config'
import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { REPL } from '../screens/REPL.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'
import { loadRuntimeConfig } from '../env/config.js'
import { loadToolDefinitions } from '../tools/loader.js'
import { createToolExecutor } from '../tools/executor/index.js'
import { LocalToolHandler } from '../tools/executor/handlers/local.js'
import { createSubAgentRegistry } from '../subagents/registry.js'
import { createSubAgentRunner } from '../subagents/runner.js'
import { createTaskSubAgentToolHandler } from '../tools/executor/handlers/taskSubAgent.js'
import { AnthropicStreamClient } from '../streaming/anthropic/StreamClient.js'
import { createChatEngine } from '../chat/engine.js'

async function main() {
  // 启动控制台日志服务器（可选，通过环境变量控制）
  const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'
  if (enableLogger) {
    const port = parseInt(process.env.CONSOLE_LOGGER_PORT || '3001', 10)
    startConsoleLogger(port)
  }

  // Optional: clear screen for a clean chat view
  await clearTerminal()

  const cfg = loadRuntimeConfig(process.env, process.cwd())
  const tools = await loadToolDefinitions({ filePath: cfg.paths.toolsJsonPath })

  const subAgentRegistry = createSubAgentRegistry()
  await subAgentRegistry.loadFromDirectory(cfg.paths.subagentsDir)
  const allowedSubagents = subAgentRegistry.list()

  const client = new AnthropicStreamClient({
    apiKey: cfg.llm.apiKey,
    baseUrl: cfg.llm.baseUrl,
    model: cfg.llm.model || 'claude-sonnet-4-5-20250929',
    timeoutMs: cfg.llm.timeoutMs,
  })

  const localHandler = new LocalToolHandler()
  const localExecutor = createToolExecutor([localHandler])
  const subAgentRunner = createSubAgentRunner({
    client,
    executor: localExecutor,
    allTools: tools,
  })

  const taskHandler = createTaskSubAgentToolHandler({
    registry: subAgentRegistry,
    runner: subAgentRunner,
  })

  const executor = createToolExecutor([taskHandler, localHandler])
  const engine = createChatEngine({ client, executor })

  render(
    <REPL
      engine={engine}
      tools={tools}
      cfg={cfg}
      allowedSubagents={allowedSubagents}
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
