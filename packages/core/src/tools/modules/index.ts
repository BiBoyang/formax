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
import { createSlashCommandToolModule } from './slashCommand'
import { skillToolModule } from './skill'
import { todoWriteToolModule } from './todoWrite'
import { webSearchToolModule } from './webSearch'
import { createWriteToolModule } from './write'
import { createEnterPlanModeToolModule } from './enterPlanMode'
import { createExitPlanModeToolModule } from './exitPlanMode'

export function registerBuiltinToolModules(
  registry: ToolRegistry,
  deps: { taskManager: TaskManager; userInput: UserInputManager; cwd: string },
): void {
  registry.register(createBashToolModule({ taskManager: deps.taskManager }))
  registry.register(createEditToolModule())
  registry.register(createEnterPlanModeToolModule(deps.userInput))
  registry.register(createExitPlanModeToolModule(deps.userInput))
  registry.register(globToolModule)
  registry.register(grepToolModule)
  registry.register(createNotebookEditToolModule())
  registry.register(readToolModule)
  registry.register(searchToolModule)
  registry.register(createSlashCommandToolModule({ cwd: deps.cwd }))
  registry.register(skillToolModule)
  registry.register(todoWriteToolModule)
  registry.register(webSearchToolModule)
  registry.register(createWriteToolModule())
}
