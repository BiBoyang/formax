import type { ToolModule } from '../../registry'
import { ExitPlanModeToolHandler } from './handler'

export const exitPlanModeToolModule: ToolModule = {
  name: 'ExitPlanMode',
  handler: ExitPlanModeToolHandler,
  specOverride: {
    name: 'ExitPlanMode',
    description:
      'Exit plan mode. Use this once planning is complete and the user has approved execution, so you can proceed with edits and running commands.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
}

