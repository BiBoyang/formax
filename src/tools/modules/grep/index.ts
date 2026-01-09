import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { GrepToolHandler } from './handler'
import { GrepToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Grep',
  description:
    'Search files for a regex pattern. Returns matching lines in "file:line:content" format (limited).',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'File or directory to search in (defaults to cwd).' },
      glob: { type: 'string', description: 'Glob to filter files (default: "**/*").' },
      '-i': { type: 'boolean', description: 'Case insensitive search.' },
    },
    required: ['pattern'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const grepToolModule: ToolModule = {
  name: 'Grep',
  handler: GrepToolHandler,
  presenter: GrepToolPresenter,
  spec,
}
