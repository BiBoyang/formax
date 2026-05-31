import { getKnownContextWindowTokens } from './modelContextWindow.js'
import { sameModelIdentity, buildRuntimeModelProfileFingerprint } from './modelCapability.js'
import type { RuntimeModelProfile } from './modelCapability.js'
import type { RuntimeConfig } from './config.js'
import { normalizeModelTier } from './modelTier.js'

export function resolveRuntimeModelProfile(args: {
  cfg: RuntimeConfig
  runtimeFlagFingerprint?: string
}): RuntimeModelProfile {
  const contextCfg = args.cfg.context ?? {
    effectiveContextWindowPercent: 0.95,
    autoCompactTokenLimitPercent: 0.9,
    baselineTokens: 12000,
  }
  const activeTier = normalizeModelTier(args.cfg.llm.defaultTier, 'sonnet')
  const model = String(args.cfg.llm.model || '').trim()
  const modelSource = args.cfg.llm.modelSource ?? 'default_model'
  const binding = args.cfg.llm.tierContextWindowBindings?.[activeTier]
  const bindingMatches = binding
    ? sameModelIdentity(binding, {
        provider: args.cfg.llm.provider,
        baseUrl: args.cfg.llm.baseUrl,
        model,
      })
    : false

  const configuredTokens = args.cfg.llm.contextWindowTokens
  const configuredSource =
    args.cfg.llm.contextWindowTokensSource ??
    (configuredTokens != null ? (args.cfg.llm.contextWindowTokensBinding ? 'tier_config' : 'legacy_config') : 'none')

  const effectiveConfiguredSource =
    configuredSource === 'tier_config' && binding && !bindingMatches ? 'binding_mismatch' : configuredSource

  const knownModelMapTokens =
    getKnownContextWindowTokens({
      provider: args.cfg.llm.provider,
      model,
    }) ?? undefined

  const contextWindowTokens =
    effectiveConfiguredSource === 'binding_mismatch'
      ? configuredTokens ?? knownModelMapTokens
      : configuredTokens ?? knownModelMapTokens

  const contextWindowTokensSource =
    effectiveConfiguredSource === 'binding_mismatch'
      ? configuredTokens != null
        ? 'legacy_config'
        : knownModelMapTokens != null
          ? 'known_model_map'
          : 'binding_mismatch'
      : configuredTokens != null
        ? effectiveConfiguredSource
        : knownModelMapTokens != null
          ? 'known_model_map'
          : 'none'

  const contextWindowTokensBinding =
    effectiveConfiguredSource !== 'binding_mismatch' &&
    effectiveConfiguredSource !== 'env_override' &&
    effectiveConfiguredSource !== 'legacy_config' &&
    effectiveConfiguredSource !== 'migrated_legacy' &&
    effectiveConfiguredSource !== 'none' &&
    bindingMatches
      ? binding
      : undefined

  const fingerprint = buildRuntimeModelProfileFingerprint({
    provider: args.cfg.llm.provider,
    baseUrl: args.cfg.llm.baseUrl,
    authRef: args.cfg.llm.authRef ?? 'default',
    apiKey: args.cfg.llm.apiKey,
    timeoutMs: args.cfg.llm.timeoutMs,
    activeTier,
    model,
    modelSource,
    contextWindowTokens,
    contextWindowTokensSource,
    contextWindowTokensBinding,
    effectiveContextWindowPercent: contextCfg.effectiveContextWindowPercent,
    autoCompactTokenLimitPercent: contextCfg.autoCompactTokenLimitPercent,
    baselineTokens: contextCfg.baselineTokens,
    thinkingMode: args.cfg.llm.thinkingMode ?? true,
    runtimeFlagFingerprint: args.runtimeFlagFingerprint,
  })

  return {
    fingerprint,
    provider: args.cfg.llm.provider,
    baseUrl: args.cfg.llm.baseUrl,
    authRef: args.cfg.llm.authRef ?? 'default',
    activeTier,
    model,
    modelSource,
    ...(contextWindowTokens != null ? { contextWindowTokens } : {}),
    contextWindowTokensSource,
    ...(contextWindowTokensBinding
      ? {
          contextWindowTokensBinding,
          contextWindowTokensBoundModel: contextWindowTokensBinding.model,
        }
      : {}),
    effectiveContextWindowPercent: contextCfg.effectiveContextWindowPercent,
    autoCompactTokenLimitPercent: contextCfg.autoCompactTokenLimitPercent,
    baselineTokens: contextCfg.baselineTokens,
    thinkingMode: args.cfg.llm.thinkingMode ?? true,
  }
}
