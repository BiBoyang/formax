#!/usr/bin/env node

import 'dotenv/config'
import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { REPL } from '../screens/REPL.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'
import { loadRuntimeConfig } from '../env/config.js'
import { createToolExecutor } from '../tools/executor/index.js'
import { createSubAgentRegistry } from '../subagents/registry.js'
import { createSubAgentRunner } from '../subagents/runner.js'
import { createTaskSubAgentToolHandler } from '../tools/executor/handlers/taskSubAgent.js'
import { AnthropicStreamClient } from '../streaming/anthropic/StreamClient.js'
import { createChatEngine } from '../chat/engine.js'
import { ToolRegistry } from '../tools/registry.js'
import { patchTaskToolForSubagents } from '../tools/patches/taskSubagent.js'
import { registerBuiltinToolModules } from '../tools/modules/index.js'
import { createTaskToolModule } from '../tools/modules/task/index.js'
import { createWebFetchToolModule } from '../tools/modules/webFetch/index.js'
import { TaskManager } from '../tools/runtime/taskManager.js'
import { createTaskOutputToolModule } from '../tools/modules/taskOutput/index.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { createAskUserQuestionToolModule } from '../tools/modules/askUserQuestion/index.js'
import { createKillShellToolModule } from '../tools/modules/killShell/index.js'
import { UserInputProvider } from '../tools/runtime/userInputContext.js'

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
  const model = cfg.llm.model || 'claude-sonnet-4-5-20250929'

  const client = new AnthropicStreamClient({
    apiKey: cfg.llm.apiKey,
    baseUrl: cfg.llm.baseUrl,
    model,
    timeoutMs: cfg.llm.timeoutMs,
  })

	  const webFetchClient = new AnthropicStreamClient({
    apiKey: cfg.llm.apiKey,
    baseUrl: cfg.llm.baseUrl,
    model: process.env.FORMAX_WEBFETCH_MODEL || model,
    timeoutMs: cfg.llm.timeoutMs,
  })

  const toolRegistry = new ToolRegistry()
  const taskManager = new TaskManager()
  const userInputManager = createUserInputManager()
  registerBuiltinToolModules(toolRegistry, { taskManager, userInput: userInputManager })
  toolRegistry.register(
    createWebFetchToolModule({
      client: webFetchClient,
      maxTokens: Number(process.env.FORMAX_WEBFETCH_MAX_TOKENS || 1024),
      maxInputChars: Number(process.env.FORMAX_WEBFETCH_MAX_INPUT_CHARS || 120000),
    }),
  )

  toolRegistry.register(createTaskOutputToolModule(taskManager))
  toolRegistry.register(createKillShellToolModule(taskManager))

  toolRegistry.register(createAskUserQuestionToolModule(userInputManager))

  const subAgentRegistry = createSubAgentRegistry()
  await subAgentRegistry.loadFromDirectory(cfg.paths.subagentsDir)
  const allowedSubagents = subAgentRegistry.list()

  const toolsForSubagents = await toolRegistry.listSpecs()
  const localExecutor = createToolExecutor(toolRegistry.getHandlers())
  const subAgentRunner = createSubAgentRunner({
    client,
    executor: localExecutor,
    allTools: toolsForSubagents,
  })

  const taskHandler = createTaskSubAgentToolHandler({
    registry: subAgentRegistry,
    runner: subAgentRunner,
    taskManager,
  })

  toolRegistry.register(createTaskToolModule(taskHandler))
  if (process.env.FORMAX_PATCH_TASK_TOOL !== 'false') {
    toolRegistry.addPatch((tools) => patchTaskToolForSubagents(tools, allowedSubagents))
  }
  const tools = await toolRegistry.listSpecs()
  const executor = createToolExecutor(toolRegistry.getHandlers())
  const engine = createChatEngine({ client, executor })

  render(
    <UserInputProvider userInput={userInputManager}>
      <REPL
        engine={engine}
        tools={tools}
        cfg={cfg}
        allowedSubagents={allowedSubagents}
        toolRegistry={toolRegistry}
        taskManager={taskManager}
        onExit={() => {
          stopConsoleLogger()
          process.exit(0)
        }}
      />
    </UserInputProvider>,
    {
      exitOnCtrlC: false,
    },
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
