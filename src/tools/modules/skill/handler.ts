import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

export const SkillToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Skill'
  },

  async execute(call: ToolCall, _ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = requirePlainObject(call.input || {}, 'Skill.input')
      assertNoExtraKeys(input, ['skill'], 'Skill.input')

      const raw = (input as any).skill
      const skill = typeof raw === 'string' ? raw.trim() : ''
      if (!skill) throw new Error('Missing skill')

      return {
        tool_use_id: call.id,
        content:
          `Error: Skill "${skill}" is not implemented in Formax yet. ` +
          'This spec is present to mirror Claude Code, but execution is not supported.',
        is_error: true,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}
