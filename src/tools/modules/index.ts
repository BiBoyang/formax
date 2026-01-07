import type { ToolRegistry } from '../registry'
import type { TaskManager } from '../runtime/taskManager'
import { createBashToolModule } from './bash'
import { editToolModule } from './edit'
import { globToolModule } from './glob'
import { grepToolModule } from './grep'
import { notebookEditToolModule } from './notebookEdit'
import { readToolModule } from './read'
import { searchToolModule } from './search'
import { todoWriteToolModule } from './todoWrite'
import { webSearchToolModule } from './webSearch'
import { writeToolModule } from './write'

export function registerBuiltinToolModules(
  registry: ToolRegistry,
  deps: { taskManager: TaskManager },
): void {
  registry.register(createBashToolModule(deps.taskManager))
  registry.register(editToolModule)
  registry.register(globToolModule)
  registry.register(grepToolModule)
  registry.register(notebookEditToolModule)
  registry.register(readToolModule)
  registry.register(searchToolModule)
  registry.register(todoWriteToolModule)
  registry.register(webSearchToolModule)
  registry.register(writeToolModule)
}
