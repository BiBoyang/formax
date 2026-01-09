import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import type { UserInputManager } from '../../runtime/userInputManager'
import { createNotebookEditToolHandler } from './handler'
import { NotebookEditToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'NotebookEdit',
  description: 'Edit a Jupyter notebook cell by id (replace/insert/delete).',
  input_schema: {
    type: 'object',
    properties: {
      notebook_path: { type: 'string', description: 'Absolute path to the notebook (.ipynb).' },
      cell_id: { type: 'string', description: 'Cell id to edit (required for replace/delete).' },
      new_source: { type: 'string', description: 'New cell source.' },
      cell_type: {
        type: 'string',
        enum: ['code', 'markdown'],
        description: 'Cell type (required for insert; optional for replace).',
      },
      edit_mode: {
        type: 'string',
        enum: ['replace', 'insert', 'delete'],
        description: 'Edit mode (default: replace).',
      },
    },
    required: ['notebook_path', 'new_source'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createNotebookEditToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'NotebookEdit',
    handler: createNotebookEditToolHandler(userInput),
    presenter: NotebookEditToolPresenter,
    spec,
  }
}
