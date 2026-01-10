import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { GlobToolHandler } from './handler'
import { GlobToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Glob',
  description:
    '- Fast file pattern matching tool that works with any codebase size\n' +
    '- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n' +
    '- Returns matching file paths sorted by modification time (newest first)\n' +
    '- Use this tool when you need to find files by name patterns\n' +
    '- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n' +
    '- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.\n\n' +
    'Notes:\n' +
    '- Includes dotfiles (e.g. ".cursorrules").\n' +
    '- Skips ".git" and "node_modules" directories.\n' +
    '- Returns "No files found" when there are no matches.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against.' },
      path: {
        type: 'string',
        description:
          'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
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
