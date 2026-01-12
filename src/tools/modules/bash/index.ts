import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'
import { spec } from './spec'

export function createBashToolModule(deps: { taskManager: TaskManager; userInput: UserInputManager }): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager: deps.taskManager, userInput: deps.userInput }),
    presenter: BashToolPresenter,
    spec,
  }
}
