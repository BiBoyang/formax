import type { ToolModule } from '../../registry'
import { WebSearchToolHandler } from './handler'
import type { ToolDefinition } from '../../types'

const spec: ToolDefinition = {
  name: 'WebSearch',
  description: 'Search the web for information and return top results.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional allowlist of domains (e.g. ["example.com"]).',
      },
      blocked_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional blocklist of domains.',
      },
    },
    required: ['query'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const webSearchToolModule: ToolModule = {
  name: 'WebSearch',
  handler: WebSearchToolHandler,
  specOverride: spec,
}

