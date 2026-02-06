import type { RuntimeConfig } from '../../env/config.js'
import { AnthropicStreamClient } from '../../streaming/anthropic/StreamClient.js'

export type LlmClients = {
  model: string
  client: AnthropicStreamClient
  webFetchClient: AnthropicStreamClient
}

export function createLlmClients(args: {
  cfg: RuntimeConfig
  env: NodeJS.ProcessEnv
}): LlmClients {
  const model = args.cfg.llm.model || 'claude-sonnet-4-5-20250929'
  const client = new AnthropicStreamClient({
    apiKey: args.cfg.llm.apiKey,
    baseUrl: args.cfg.llm.baseUrl,
    model,
    timeoutMs: args.cfg.llm.timeoutMs,
  })

  const webFetchClient = new AnthropicStreamClient({
    apiKey: args.cfg.llm.apiKey,
    baseUrl: args.cfg.llm.baseUrl,
    model: args.env.FORMAX_WEBFETCH_MODEL || model,
    timeoutMs: args.cfg.llm.timeoutMs,
  })

  return { model, client, webFetchClient }
}
