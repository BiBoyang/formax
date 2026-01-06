import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../index'

export function createTaskSubAgentToolHandler(deps: {
  registry: SubAgentRegistry
  runner: SubAgentRunner
}): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Task'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      const input = call.input || {}
      const subagentType = (input as any).subagent_type
      const prompt = (input as any).prompt

      if (typeof subagentType !== 'string' || typeof prompt !== 'string') {
        return {
          tool_use_id: call.id,
          content: 'Error: Missing required fields subagent_type or prompt.',
          is_error: true,
        }
      }

      const agent = deps.registry.get(subagentType)
      if (!agent) {
        return {
          tool_use_id: call.id,
          content: `Error: Sub-agent type '${subagentType}' not found.`,
          is_error: true,
        }
      }

      const result = await deps.runner.run({ agent, task: prompt, signal: ctx.signal })
      const summary = result.summary || ''
      const limited = summary.length > 500 ? summary.slice(0, 500) + '…' : summary

      if (result.artifacts && result.artifacts.length > 0) {
        return {
          tool_use_id: call.id,
          content: JSON.stringify({ summary: limited, artifacts: result.artifacts }, null, 2),
          is_error: !result.success,
        }
      }

      return {
        tool_use_id: call.id,
        content: limited || (result.success ? '(no output)' : `Error: ${result.error || 'Sub-agent failed'}`),
        is_error: !result.success,
      }
    },
  }
}

