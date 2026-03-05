import type { ToolDefinition } from '../../types'

export const toolSearchToolSpec: ToolDefinition = {
  name: 'ToolSearch',
  description:
    'Search for deferred tools and load them for immediate use. '
    + 'Use `select:<tool_name>` for exact names, or plain keywords to find matching tools.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Tool search query. Examples: "select:Bash" or "read file"',
      },
    },
    required: ['query'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}
