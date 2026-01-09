import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createWriteToolHandler } from './handler'
import { WriteToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Write',
  description:
    'Write a text file to the local filesystem (overwrites if exists).\n\nNotes:\n- file_path should be an absolute path when possible (relative paths are resolved from the current working directory).\n- In normal mode, requires user approval unless accept-edits mode is enabled.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to write (absolute preferred).' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createWriteToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'Write',
    handler: createWriteToolHandler(userInput),
    presenter: WriteToolPresenter,
    spec,
  }
}
