import type { ToolDefinition } from '../types'

export type SubagentInfo = { name: string; description: string }

export function patchTaskToolForSubagents(
  tools: ToolDefinition[],
  allowedSubagents: SubagentInfo[] = [],
): ToolDefinition[] {
  const taskTool: ToolDefinition = {
    name: 'Task',
    description: buildTaskToolDescription(allowedSubagents),
    input_schema: buildTaskToolInputSchema(allowedSubagents),
  }

  const hasTask = tools.some((t) => t.name === 'Task')
  const patched = tools.map((t) => (t.name === 'Task' ? taskTool : t))

  return hasTask ? patched : [taskTool, ...patched]
}

function buildTaskToolDescription(allowedSubagents: SubagentInfo[]): string {
  const header =
    'Run a local sub-agent (defined in .agent/subagents/*.md) with isolated context and a strict tool allowlist. Returns a short summary only. Set run_in_background=true to run asynchronously and use TaskOutput to retrieve results.'

  const list = allowedSubagents
    .filter((a) => a?.name)
    .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ''}`)
    .join('\n')

  if (!list) return header

  return `${header}\n\nAvailable subagents (Task.subagent_type):\n${list}`
}

function buildTaskToolInputSchema(allowedSubagents: SubagentInfo[]): unknown {
  const enumValues = allowedSubagents
    .map((a) => a?.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)

  return {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which sub-agent to run.',
        ...(enumValues.length > 0 ? { enum: enumValues } : {}),
      },
      prompt: {
        type: 'string',
        description: 'The task for the sub-agent. Provide all necessary context here.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run the sub-agent in the background. Use TaskOutput to retrieve results.',
      },
    },
    required: ['subagent_type', 'prompt'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  }
}
