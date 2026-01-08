import type { ToolModule } from '../../registry'
import { EnterPlanModeToolHandler } from './handler'

export const enterPlanModeToolModule: ToolModule = {
  name: 'EnterPlanMode',
  handler: EnterPlanModeToolHandler,
  specOverride: {
    name: 'EnterPlanMode',
    description:
      'Enter plan mode. Use this when the user requests planning/analysis only. In plan mode, avoid making edits or running commands until the user approves.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
}

