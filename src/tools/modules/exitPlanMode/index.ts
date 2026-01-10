import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createExitPlanModeToolHandler } from './handler'
import { ExitPlanModeToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'ExitPlanMode',
  description:
    "Ask the user to approve exiting plan mode after you've finished planning.\n\nUse this once you have a clear plan and are ready to proceed with implementation. The user can choose auto-accept edits, manual per-edit approvals, or request plan changes.",
  input_schema: {
    type: 'object',
    properties: {
      launchSwarm: {
        type: 'boolean',
        description: 'Whether to launch a swarm to implement the plan.',
      },
      teammateCount: {
        type: 'number',
        description: 'Number of teammates to spawn in the swarm.',
      },
    },
    additionalProperties: true,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createExitPlanModeToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'ExitPlanMode',
    handler: createExitPlanModeToolHandler(userInput),
    presenter: ExitPlanModeToolPresenter,
    spec,
    meta: { interactive: true },
  }
}
