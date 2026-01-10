import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { ReadToolHandler } from './handler'
import { ReadToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Read',
  description:
    'Read a text file from the local filesystem.\n\nNotes:\n- file_path must be an absolute path (supports ~).\n- By default reads up to 2000 lines.\n- Supports offset/limit for large files.\n- Output is returned in cat -n format (line numbers start at 1).',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to read (supports ~).' },
      offset: { type: 'number', description: '1-based line number to start reading from.' },
      limit: { type: 'number', description: 'Max number of lines to read.' },
    },
    required: ['file_path'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const readToolModule: ToolModule = {
  name: 'Read',
  handler: ReadToolHandler,
  presenter: ReadToolPresenter,
  spec,
}
