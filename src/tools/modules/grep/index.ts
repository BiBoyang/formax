import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { GrepToolHandler } from './handler'
import { GrepToolPresenter } from './presenter'

const spec: ToolDefinition = {
  name: 'Grep',
  description:
    'Search files for a regex pattern.\n\nNotes:\n- Supports searching a single file path or a directory.\n- The glob filter matches paths relative to the search root.\n- Skips ".git" and "node_modules" directories.\n- Returns "No matches found" when there are no matches.\n- Output mode defaults to "files_with_matches" to reduce token usage.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'File or directory to search in (defaults to cwd).' },
      glob: { type: 'string', description: 'Glob to filter files (default: "**/*").' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description:
          'Output mode: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts.',
      },
      '-B': {
        type: 'number',
        description: 'Number of lines to show before each match (requires output_mode="content").',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines to show after each match (requires output_mode="content").',
      },
      '-C': {
        type: 'number',
        description: 'Number of lines to show before and after each match (requires output_mode="content").',
      },
      '-n': {
        type: 'boolean',
        description: 'Show line numbers in output (requires output_mode="content").',
      },
      '-i': { type: 'boolean', description: 'Case insensitive search.' },
      type: {
        type: 'string',
        description: 'File type to search (e.g. js, ts, py). This is a hint for filtering by extension.',
      },
      head_limit: {
        type: 'number',
        description:
          'Limit output to first N lines/entries (default: 50; 0 = unlimited). Works across output modes.',
      },
      offset: {
        type: 'number',
        description: 'Skip first N lines/entries before applying head_limit.',
      },
      multiline: {
        type: 'boolean',
        description: 'Enable multiline mode where . matches newlines and patterns can span lines.',
      },
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
