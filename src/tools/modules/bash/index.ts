import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'
import type { ToolDefinition } from '../../types'

export function createBashToolModule(deps: { taskManager: TaskManager; userInput: UserInputManager }): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager: deps.taskManager, userInput: deps.userInput }),
    presenter: BashToolPresenter,
    specOverride: (base?: ToolDefinition) => {
      const baseSchema = (base?.input_schema && typeof base.input_schema === 'object' ? base.input_schema : {}) as any
      const props = (baseSchema.properties && typeof baseSchema.properties === 'object' ? baseSchema.properties : {}) as Record<
        string,
        any
      >

      return {
        ...(base ?? { name: 'Bash', description: 'Execute a shell command', input_schema: {} }),
        input_schema: {
          ...baseSchema,
          properties: {
            ...props,
            confirm: {
              type: 'boolean',
              description:
                'Whether the assistant is requesting confirmation before running a command that may have side effects.',
            },
          },
        },
      }
    },
  }
}
