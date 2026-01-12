import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export const SkillToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Skill'
  },

  async execute(call: ToolCall, _ctx: ExecutionContext): Promise<ToolResult> {
    return {
      tool_use_id: call.id,
      content:
        'Error: Skill tool is not implemented in Formax yet. ' +
        'This spec is present to mirror Claude Code, but execution is not supported.',
      is_error: true,
    }
  },
}

