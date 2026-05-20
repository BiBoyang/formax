import type { RuntimeConfig } from '../../config/config.js'
import { resolveAnthropicCacheEditingBetaHeader } from '../../chat/context/cacheEditing.js'
import type { AnthropicCompatibleStreamClient } from '../../streaming/index.js'
import { createAnthropicCompatibleStreamClient } from '../../streaming/index.js'

export type LlmClients = {
  model: string
  client: AnthropicCompatibleStreamClient
  webFetchClient: AnthropicCompatibleStreamClient
}

export function createLlmClients(args: {
  cfg: RuntimeConfig
  env: NodeJS.ProcessEnv
}): LlmClients {
  const model = String(args.cfg.llm.model || '').trim()
  if (!model) {
    throw new Error('Missing llm.model in runtime config')
  }

  const cacheEditingBetaHeader = resolveAnthropicCacheEditingBetaHeader({
    provider: args.cfg.llm.provider,
    baseUrl: args.cfg.llm.baseUrl,
    env: args.env,
  })

  const client = createAnthropicCompatibleStreamClient({
    provider: args.cfg.llm.provider,
    apiKey: args.cfg.llm.apiKey,
    baseUrl: args.cfg.llm.baseUrl,
    model,
    timeoutMs: args.cfg.llm.timeoutMs,
    cacheEditingBetaHeader,
  })

  const webFetchClient = createAnthropicCompatibleStreamClient({
    provider: args.cfg.llm.provider,
    apiKey: args.cfg.llm.apiKey,
    baseUrl: args.cfg.llm.baseUrl,
    model: args.env.FORMAX_WEBFETCH_MODEL || model,
    timeoutMs: args.cfg.llm.timeoutMs,
    cacheEditingBetaHeader: null,
  })

  return { model, client, webFetchClient }
}
