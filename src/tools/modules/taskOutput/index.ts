import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createTaskOutputToolHandler } from './handler'
import { TaskOutputToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'TaskOutput',
  description:
    'Retrieve output from a running or completed background task. Use block=true to wait for completion.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'The task ID to get output from.' },
      block: {
        type: 'boolean',
        default: true,
        description: 'Whether to wait for completion.',
      },
      timeout: {
        type: 'number',
        minimum: 0,
        maximum: 600000,
        default: 30000,
        description: 'Max wait time in ms.',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createTaskOutputToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'TaskOutput',
    handler: createTaskOutputToolHandler(taskManager),
    presenter: TaskOutputToolPresenter,
    specOverride: spec,
  }
}

