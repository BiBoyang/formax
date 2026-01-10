import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createEditToolHandler } from './handler'
import { EditToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Edit',
  description:
    'Perform exact string replacements in a file.\n\nNotes:\n- file_path must be an absolute path (supports ~).\n- When copying from Read output, do NOT include the cat -n line number prefix in old_string/new_string.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to modify (supports ~).' },
      old_string: { type: 'string', description: 'Exact text to replace.' },
      new_string: { type: 'string', description: 'Replacement text (must differ from old_string).' },
      replace_all: { type: 'boolean', default: false, description: 'Replace all occurrences (default false).' },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createEditToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'Edit',
    handler: createEditToolHandler(userInput),
    presenter: EditToolPresenter,
    spec,
  }
}
