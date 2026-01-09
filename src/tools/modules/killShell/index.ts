import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createKillShellToolHandler } from './handler'
import { KillShellToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'KillShell',
  description: 'Kill a running background Bash command by its shell_id (use /tasks to find IDs).',
  input_schema: {
    type: 'object',
    properties: {
      shell_id: { type: 'string', description: 'The ID of the background shell to kill.' },
    },
    required: ['shell_id'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createKillShellToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'KillShell',
    handler: createKillShellToolHandler(taskManager),
    presenter: KillShellToolPresenter,
    spec,
  }
}
