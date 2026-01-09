import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { GlobToolHandler } from './handler'
import { GlobToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Glob',
  description:
    'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.tsx"). Returns matching absolute file paths, one per line.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match against file paths.' },
      path: {
        type: 'string',
        description: 'Directory to search in (defaults to current working directory).',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const globToolModule: ToolModule = {
  name: 'Glob',
  handler: GlobToolHandler,
  presenter: GlobToolPresenter,
  spec,
}
