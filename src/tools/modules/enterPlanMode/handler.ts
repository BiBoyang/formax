import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const EnterPlanModeToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'EnterPlanMode'
  },

  async execute(call: ToolCall, _ctx: ExecutionContext): Promise<ToolResult> {
    return { tool_use_id: call.id, content: 'Entered plan mode.' }
  },
}

