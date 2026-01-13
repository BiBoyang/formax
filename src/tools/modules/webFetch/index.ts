import type { AnthropicStreamClient } from '../../../streaming/anthropic/StreamClient'
import type { ToolModule } from '../../registry'
import { createWebFetchToolHandler } from './handler'
import { WebFetchToolPresenter } from './presenter'
import { spec } from './spec'

export function createWebFetchToolModule(deps: {
  client: AnthropicStreamClient
  maxTokens?: number
  maxInputChars?: number
}): ToolModule {
  return {
    name: 'WebFetch',
    handler: createWebFetchToolHandler(deps),
    presenter: WebFetchToolPresenter,
    spec,
  }
}
