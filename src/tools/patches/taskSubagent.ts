import type { ToolDefinition } from '../types'
import { spec as taskSpec } from '../modules/task/spec'

export type SubagentInfo = { name: string; description: string }

export function patchTaskToolForSubagents(
  tools: ToolDefinition[],
  allowedSubagents: SubagentInfo[] = [],
): ToolDefinition[] {
  const hasTask = tools.some((t) => t.name === 'Task')
  const patched = tools.map((t) => (t.name === 'Task' ? patchTaskTool(t, allowedSubagents) : t))

  return hasTask ? patched : [patchTaskTool(taskSpec, allowedSubagents), ...patched]
}

function patchTaskTool(taskTool: ToolDefinition, allowedSubagents: SubagentInfo[]): ToolDefinition {
  return {
    ...taskTool,
    input_schema: patchTaskToolInputSchema(taskTool.input_schema, allowedSubagents),
  }
}

function patchTaskToolInputSchema(inputSchema: unknown, allowedSubagents: SubagentInfo[]): unknown {
  const schema = (inputSchema && typeof inputSchema === 'object' ? (inputSchema as any) : {}) as any

  if (schema.type !== 'object') return inputSchema
  if (!schema.properties || typeof schema.properties !== 'object') return inputSchema

  const enumValues = allowedSubagents
    .map((a) => a?.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)

  if (enumValues.length === 0) return inputSchema

  const subagent = schema.properties.subagent_type
  if (!subagent || typeof subagent !== 'object') return inputSchema

  return {
    ...schema,
    properties: {
      ...schema.properties,
      subagent_type: {
        ...subagent,
        enum: enumValues,
      },
    },
  }
}
