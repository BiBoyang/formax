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
    'Launch a new agent to handle complex, multi-step tasks.\n\nNotes:\n- Set run_in_background=true to run asynchronously and use TaskOutput to retrieve results.\n- Use resume to continue an existing agent by ID.\n- Prefer providing a short description to help users understand what is running.'

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
      description: {
        type: 'string',
        description: 'A short (3-5 word) description of the task',
      },
      subagent_type: {
        type: 'string',
        description: 'Which sub-agent to run.',
        ...(enumValues.length > 0 ? { enum: enumValues } : {}),
      },
      prompt: {
        type: 'string',
        description: 'The task for the sub-agent. Provide all necessary context here.',
      },
      model: {
        type: 'string',
        enum: ['sonnet', 'opus', 'haiku'],
        description:
          'Optional model to use for this agent. If not specified, inherits from parent. Prefer haiku for quick tasks.',
      },
      resume: {
        type: 'string',
        description: 'Optional agent ID to resume from. If provided, continues from previous context.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run the sub-agent in the background. Use TaskOutput to retrieve results.',
      },
    },
    required: ['description', 'subagent_type', 'prompt'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  }
}
