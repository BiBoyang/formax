import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createAskUserQuestionToolHandler } from './handler'
import { AskUserQuestionToolPresenter } from './presenter'
import { spec } from './spec'

export function createAskUserQuestionToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'AskUserQuestion',
    handler: createAskUserQuestionToolHandler(userInput),
    presenter: AskUserQuestionToolPresenter,
    spec,
    meta: { interactive: true },
  }
}
