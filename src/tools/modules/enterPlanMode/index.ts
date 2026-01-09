import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createEnterPlanModeToolHandler } from './handler'
import { EnterPlanModeToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'EnterPlanMode',
  description:
    "Ask the user to enter plan mode. Use this proactively before non-trivial implementations so you can explore and propose a plan before making edits.\n\nIn plan mode, avoid making edits or running destructive commands until the user approves and you exit plan mode.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

export function createEnterPlanModeToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'EnterPlanMode',
    handler: createEnterPlanModeToolHandler(userInput),
    presenter: EnterPlanModeToolPresenter,
    spec,
    meta: { interactive: true },
  }
}
