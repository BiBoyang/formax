import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'

export function createBashToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager }),
    presenter: BashToolPresenter,
  }
}

