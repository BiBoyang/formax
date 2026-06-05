import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'
import { createSubAgentRegistry } from '../../features/subagents/registry.js'
import { createSubAgentRunner } from '../../features/subagents/runner.js'
import type { SubAgentListItem } from '../../features/subagents/types.js'
import { createTaskSubAgentToolHandler } from '../../tools/executor/handlers/taskSubAgent.js'
import { createTaskToolModule } from '../../tools/modules/task/index.js'
import { patchTaskToolForSubagents } from '../../tools/patches/taskSubagent.js'
import { getKnownContextWindowTokens } from '../../chat/context/modelWindow.js'
import type { RuntimeConfig } from '../../config/config.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { TaskManager } from '../../tools/runtime/taskManager.js'
import type { AnthropicCompatibleStreamClient } from '../../streaming/index.js'
import type { ToolPreflight } from '../../tools/executor/index.js'
import { createToolExecutor } from '../../tools/executor/index.js'

export type SubagentRuntime = {
  allowedSubagents: SubAgentListItem[]
  reloadSubagents: () => Promise<SubAgentListItem[]>
  refreshTools: () => Promise<void>
  tools: Awaited<ReturnType<ToolRegistry['listSpecs']>>
}

export async function createSubagentRuntime(args: {
  cfg: RuntimeConfig
  env: NodeJS.ProcessEnv
  cwd: string
  client: AnthropicCompatibleStreamClient
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  preflight: ToolPreflight
  createLocalExecutor?: () => ReturnType<typeof createToolExecutor>
}): Promise<SubagentRuntime> {
  const subAgentRegistry = createSubAgentRegistry()
  const configPaths = getConfigPaths({ cwd: args.cwd, env: args.env })
  const userAgentsDir = path.join(configPaths.globalConfigDir, 'agents')
  const agentDirs = Array.from(new Set([userAgentsDir, args.cfg.paths.subagentsDir]))
  await subAgentRegistry.loadFromDirectories(agentDirs)
  const allowedSubagents = subAgentRegistry.list()
  const reloadSubagents = async () => {
    await subAgentRegistry.loadFromDirectories(agentDirs)
    return subAgentRegistry.list()
  }

  const toolsForSubagents = await args.toolRegistry.listSpecs()
  const contextWindowTokens = args.cfg.llm.contextWindowTokens
    ?? getKnownContextWindowTokens({ provider: args.cfg.llm.provider, model: args.cfg.llm.model })
  const promptBudget = contextWindowTokens
    ? {
        contextWindowTokens,
        effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
        autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
        baselineTokens: args.cfg.context.baselineTokens,
      }
    : null

  const localExecutor = args.createLocalExecutor
    ? args.createLocalExecutor()
    : createToolExecutor(args.toolRegistry.getHandlers(), { preflight: args.preflight })
  const subAgentRunner = createSubAgentRunner({
    client: args.client,
    executor: localExecutor,
    allTools: toolsForSubagents,
    promptBudget,
  })
  const taskHandler = createTaskSubAgentToolHandler({
    registry: subAgentRegistry,
    runner: subAgentRunner,
    taskManager: args.taskManager,
  })

  args.toolRegistry.register(createTaskToolModule(taskHandler))
  args.toolRegistry.addPatch((tools) => patchTaskToolForSubagents(tools, allowedSubagents))

  const tools = await args.toolRegistry.listSpecs()
  const refreshTools = async () => {
    const refreshedTools = await args.toolRegistry.listSpecs()
    const refreshedToolsForSubagents = refreshedTools.filter((tool) => tool.name !== 'Task')
    toolsForSubagents.splice(0, toolsForSubagents.length, ...refreshedToolsForSubagents)
    tools.splice(0, tools.length, ...refreshedTools)
  }
  return {
    allowedSubagents,
    reloadSubagents,
    refreshTools,
    tools,
  }
}
