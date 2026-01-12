import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createEditToolHandler } from './handler'
import { EditToolPresenter } from './presenter'
import { spec } from './spec'

export function createEditToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'Edit',
    handler: createEditToolHandler(userInput),
    presenter: EditToolPresenter,
    spec,
  }
}
