import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import type { ToolHandler } from '../../executor'
import { TaskToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Task',
  description:
    'Run a local sub-agent (defined in .agent/subagents/*.md) with isolated context and a strict tool allowlist. Returns a short summary.',
  input_schema: {
    type: 'object',
    properties: {
      subagent_type: { type: 'string', description: 'Which sub-agent to run.' },
      prompt: { type: 'string', description: 'Task for the sub-agent. Provide all necessary context.' },
      run_in_background: {
        type: 'boolean',
        description: 'Run the sub-agent in the background. Use TaskOutput to retrieve results.',
      },
    },
    required: ['subagent_type', 'prompt'],
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
