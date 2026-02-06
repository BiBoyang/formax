import { ToolRegistry } from '../../tools/registry.js'
import { registerBuiltinToolModules } from '../../tools/modules/index.js'
import { createWebFetchToolModule } from '../../tools/modules/webFetch/index.js'
import { TaskManager } from '../../tools/runtime/taskManager.js'
import { createTaskOutputToolModule } from '../../tools/modules/taskOutput/index.js'
import { createUserInputManager } from '../../tools/runtime/userInputManager.js'
import { createAskUserQuestionToolModule } from '../../tools/modules/askUserQuestion/index.js'
import { createKillShellToolModule } from '../../tools/modules/killShell/index.js'
import { LocalBashPresenter } from '../../tools/presenters/LocalBashPresenter.js'
import type { AnthropicStreamClient } from '../../streaming/anthropic/StreamClient.js'

export type ToolingRuntime = {
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  userInputManager: ReturnType<typeof createUserInputManager>
}

export function createToolingRuntime(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  webFetchClient: AnthropicStreamClient
}): ToolingRuntime {
  const toolRegistry = new ToolRegistry()
  const taskManager = new TaskManager()
  const userInputManager = createUserInputManager()

  registerBuiltinToolModules(toolRegistry, { taskManager, userInput: userInputManager, cwd: args.cwd })
  toolRegistry.register({ name: 'LocalBash', presenter: LocalBashPresenter })
  toolRegistry.register(
    createWebFetchToolModule({
      client: args.webFetchClient,
      maxTokens: Number(args.env.FORMAX_WEBFETCH_MAX_TOKENS || 1024),
      maxInputChars: Number(args.env.FORMAX_WEBFETCH_MAX_INPUT_CHARS || 120000),
    }),
  )

  toolRegistry.register(createTaskOutputToolModule(taskManager))
  toolRegistry.register(createKillShellToolModule(taskManager))
  toolRegistry.register(createAskUserQuestionToolModule(userInputManager))

  return {
    toolRegistry,
    taskManager,
    userInputManager,
  }
}
