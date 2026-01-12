import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createWriteToolHandler } from './handler'
import { WriteToolPresenter } from './presenter'
import { spec } from './spec'

export function createWriteToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'Write',
    handler: createWriteToolHandler(userInput),
    presenter: WriteToolPresenter,
    spec,
  }
}
