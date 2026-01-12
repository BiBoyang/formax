import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createNotebookEditToolHandler } from './handler'
import { NotebookEditToolPresenter } from './presenter'
import { spec } from './spec'

export function createNotebookEditToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'NotebookEdit',
    handler: createNotebookEditToolHandler(userInput),
    presenter: NotebookEditToolPresenter,
    spec,
  }
}
