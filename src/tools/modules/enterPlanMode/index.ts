import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createEnterPlanModeToolHandler } from './handler'
import { EnterPlanModeToolPresenter } from './presenter'
import { spec } from './spec'

export function createEnterPlanModeToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'EnterPlanMode',
    handler: createEnterPlanModeToolHandler(userInput),
    presenter: EnterPlanModeToolPresenter,
    spec,
    meta: { interactive: true },
  }
}
