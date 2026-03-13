import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createExitPlanModeToolHandler } from './handler'
import { ExitPlanModeToolPresenter } from './presenter'
import { spec } from './spec'

export function createExitPlanModeToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'ExitPlanMode',
    handler: createExitPlanModeToolHandler(userInput),
    presenter: ExitPlanModeToolPresenter,
    spec,
    meta: { interactive: true },
  }
}
