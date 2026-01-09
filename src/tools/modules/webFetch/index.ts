import type { AnthropicStreamClient } from '../../../streaming/anthropic/StreamClient'
import type { ToolDefinition } from '../../types'
import type { ToolModule } from '../../registry'
import { createWebFetchToolHandler } from './handler'

const spec: ToolDefinition = {
  name: 'WebFetch',
  description: 'Fetch a URL and answer a prompt about its content.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch (http/https).' },
      prompt: { type: 'string', description: 'What to extract from the page.' },
    },
    required: ['url', 'prompt'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export function createWebFetchToolModule(deps: {
  client: AnthropicStreamClient
  maxTokens?: number
  maxInputChars?: number
}): ToolModule {
  return {
    name: 'WebFetch',
    handler: createWebFetchToolHandler(deps),
    spec,
  }
}
