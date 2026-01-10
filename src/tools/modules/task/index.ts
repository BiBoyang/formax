import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import type { ToolHandler } from '../../executor'
import { TaskToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Task',
  description:
    'Launch a new agent to handle complex, multi-step tasks with isolated context and a strict tool allowlist. Use TaskOutput to retrieve results when run_in_background=true.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'A short (3-5 word) description of the task.' },
      subagent_type: { type: 'string', description: 'Which sub-agent to run.' },
      prompt: { type: 'string', description: 'Task for the sub-agent. Provide all necessary context.' },
      model: {
        type: 'string',
        enum: ['sonnet', 'opus', 'haiku'],
        description: 'Optional model override (if supported).',
      },
      resume: { type: 'string', description: 'Optional agent ID to resume from.' },
      run_in_background: {
        type: 'boolean',
        description: 'Run the sub-agent in the background. Use TaskOutput to retrieve results.',
      },
    },
    required: ['description', 'subagent_type', 'prompt'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createTaskToolModule(handler: ToolHandler): ToolModule {
  return {
    name: 'Task',
    handler,
    presenter: TaskToolPresenter,
    spec,
  }
}
