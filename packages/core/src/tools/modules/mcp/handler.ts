import type { McpServerManager } from '../../../mcp/serverManager'
import { isMcpModelToolName } from '../../../mcp/names'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { ToolCall, ToolResult } from '../../types'

export function createMcpToolHandler(manager: McpServerManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return isMcpModelToolName(name)
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      if (!call.input || typeof call.input !== 'object' || Array.isArray(call.input)) {
        return {
          tool_use_id: call.id,
          content: `Error: MCP tool input for ${call.name} must be a JSON object`,
          is_error: true,
        }
      }
      const input = call.input

      return await manager.callTool({
        toolUseId: call.id,
        modelName: call.name,
        arguments: input,
        signal: ctx.signal,
      })
    },
  }
}
