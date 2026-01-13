import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'
import { spec } from './spec'

export function createBashToolModule(deps: { taskManager: TaskManager }): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager: deps.taskManager }),
    presenter: BashToolPresenter,
    spec,
  }
}
