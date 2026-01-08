import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const ExitPlanModeToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'ExitPlanMode'
  },

  async execute(call: ToolCall, _ctx: ExecutionContext): Promise<ToolResult> {
    return { tool_use_id: call.id, content: 'Exited plan mode.' }
  },
}

