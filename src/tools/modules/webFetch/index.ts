import type { AnthropicCompatibleStreamClient } from '../../../streaming/index'
import type { ToolModule } from '../../registry'
import { createWebFetchToolHandler } from './handler'
import { WebFetchToolPresenter } from './presenter'
import { spec } from './spec'

export function createWebFetchToolModule(deps: {
  client: AnthropicCompatibleStreamClient
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
