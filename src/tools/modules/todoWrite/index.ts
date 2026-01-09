import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import { TodoWriteToolHandler } from './handler'
import { TodoWriteToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'TodoWrite',
  description: 'Create or update a structured todo list for the current session.',
  input_schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The updated todo list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1 },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string', minLength: 1 },
          },
          required: ['content', 'status', 'activeForm'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const todoWriteToolModule: ToolModule = {
  name: 'TodoWrite',
  handler: TodoWriteToolHandler,
  presenter: TodoWriteToolPresenter,
  spec,
}
