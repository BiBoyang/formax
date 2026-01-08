import type { ToolModule } from '../../registry'
import type { TaskManager } from '../../runtime/taskManager'
import { createBashToolHandler } from './handler'
import { BashToolPresenter } from './presenter'
import type { ToolDefinition } from '../../types'

export function createBashToolModule(taskManager: TaskManager): ToolModule {
  return {
    name: 'Bash',
    handler: createBashToolHandler({ taskManager }),
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
                'Set to true to confirm running a command that may have side effects (e.g., installs, deletes, writes).',
            },
          },
        },
      }
    },
  }
}
