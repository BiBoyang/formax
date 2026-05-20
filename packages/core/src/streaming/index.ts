import type { ProviderId } from '../config/settings/schema.js'
import { AnthropicStreamClient } from './anthropic/StreamClient.js'
import { OpenAIStreamClient } from './openai/StreamClient.js'

export type CreateStreamClientArgs = {
  provider: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs?: number
  cacheEditingBetaHeader?: string | null
}

export type AnthropicCompatibleStreamClient = AnthropicStreamClient | OpenAIStreamClient

export function createAnthropicCompatibleStreamClient(
  args: CreateStreamClientArgs,
): AnthropicCompatibleStreamClient {
  if (args.provider === 'anthropic') {
    return new AnthropicStreamClient({
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: args.model,
      timeoutMs: args.timeoutMs,
      cacheEditingBetaHeader: args.cacheEditingBetaHeader,
    })
  }

  if (args.provider === 'openai') {
    return new OpenAIStreamClient({
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: args.model,
      timeoutMs: args.timeoutMs,
    })
  }

  throw new Error(`Provider "${args.provider}" is not supported yet`)
}

export { AnthropicStreamClient } from './anthropic/StreamClient.js'
export { OpenAIStreamClient } from './openai/StreamClient.js'
