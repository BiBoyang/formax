import type { ToolRegistry } from '../registry'
import type { TaskManager } from '../runtime/taskManager'
import type { UserInputManager } from '../runtime/userInputManager'
import { createBashToolModule } from './bash'
import { createEditToolModule } from './edit'
import { globToolModule } from './glob'
import { grepToolModule } from './grep'
import { createNotebookEditToolModule } from './notebookEdit'
import { readToolModule } from './read'
import { searchToolModule } from './search'
import { slashCommandToolModule } from './slashCommand'
import { todoWriteToolModule } from './todoWrite'
import { webSearchToolModule } from './webSearch'
import { createWriteToolModule } from './write'
import { createEnterPlanModeToolModule } from './enterPlanMode'
import { createExitPlanModeToolModule } from './exitPlanMode'

export function registerBuiltinToolModules(
  registry: ToolRegistry,
  deps: { taskManager: TaskManager; userInput: UserInputManager },
): void {
  registry.register(createBashToolModule({ taskManager: deps.taskManager, userInput: deps.userInput }))
  registry.register(createEditToolModule(deps.userInput))
  registry.register(createEnterPlanModeToolModule(deps.userInput))
  registry.register(createExitPlanModeToolModule(deps.userInput))
  registry.register(globToolModule)
  registry.register(grepToolModule)
  registry.register(createNotebookEditToolModule(deps.userInput))
  registry.register(readToolModule)
  registry.register(searchToolModule)
  registry.register(slashCommandToolModule)
  registry.register(todoWriteToolModule)
  registry.register(webSearchToolModule)
  registry.register(createWriteToolModule(deps.userInput))
}
