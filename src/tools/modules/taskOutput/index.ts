import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createTaskOutputToolHandler } from './handler'
import { TaskOutputToolPresenter } from './presenter'
import { spec } from './spec'

export function createTaskOutputToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'TaskOutput',
    handler: createTaskOutputToolHandler(taskManager),
    presenter: TaskOutputToolPresenter,
    spec,
  }
}
