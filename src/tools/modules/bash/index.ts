import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'
import type { ToolDefinition } from '../../types'

const spec: ToolDefinition = {
  name: 'Bash',
  description: 'Execute a shell command.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute.' },
      cwd: { type: 'string', description: 'Optional working directory (defaults to current cwd).' },
      env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional environment variables.' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds.' },
      description: { type: 'string', description: 'Short human-readable description of what this command does.' },
      run_in_background: {
        type: 'boolean',
        description: 'Set to true to run this command in the background. Use TaskOutput to read the output later.',
      },
      confirm: {
        type: 'boolean',
        description:
          'Whether the assistant is requesting confirmation before running a command that may have side effects. This does not bypass local safety checks.',
      },
    },
    required: ['command'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createBashToolModule(deps: { taskManager: TaskManager; userInput: UserInputManager }): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager: deps.taskManager, userInput: deps.userInput }),
    presenter: BashToolPresenter,
    spec,
  }
}
