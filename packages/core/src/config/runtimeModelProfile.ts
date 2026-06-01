import { getKnownContextWindowTokens } from './modelContextWindow.js'
import { sameModelIdentity, buildRuntimeModelProfileFingerprint } from './modelCapability.js'
import type { RuntimeModelProfile } from './modelCapability.js'
import type { RuntimeConfig } from './config.js'
import { normalizeModelTier, resolveModelSelectionForTier } from './modelTier.js'
import type { ThreadRuntimePreferences } from '../features/semantics/runtime/threadRuntimeState.js'

type EffectiveRuntimeModelProfileSummary = Pick<
  RuntimeModelProfile,
  | 'fingerprint'
  | 'provider'
  | 'baseUrl'
  | 'authRef'
  | 'activeTier'
  | 'model'
  | 'modelSource'
  | 'contextWindowTokens'
  | 'contextWindowTokensSource'
  | 'contextWindowTokensBoundModel'
  | 'effectiveContextWindowPercent'
  | 'autoCompactTokenLimitPercent'
  | 'baselineTokens'
  | 'thinkingMode'
>

export type { EffectiveRuntimeModelProfileSummary }

function withRuntimePreferences(args: {
  cfg: RuntimeConfig
  preferences?: ThreadRuntimePreferences
  env?: Record<string, string | undefined>
}): RuntimeConfig {
  const preferredTier = args.preferences?.modelTier ?? args.cfg.llm.defaultTier
  const activeTier = normalizeModelTier(preferredTier, 'sonnet')
  const modelSelection = resolveModelSelectionForTier({
    tier: activeTier,
    configuredModel: args.cfg.llm.configuredModel,
    configuredTierModels: args.cfg.llm.tierModels,
    env: args.env,
  })
  const binding = args.cfg.llm.tierContextWindowBindings?.[activeTier]
  const bindingMatches = binding
    ? sameModelIdentity(binding, {
        provider: args.cfg.llm.provider,
        baseUrl: args.cfg.llm.baseUrl,
        model: modelSelection.model,
      })
    : false
  const tierContextWindow = args.cfg.llm.tierContextWindowTokens?.[activeTier]
  const contextWindowTokensSource =
    args.cfg.llm.contextWindowTokensSource === 'env_override'
      ? 'env_override'
      : tierContextWindow != null
        ? binding
          ? (bindingMatches ? args.cfg.llm.tierContextWindowSources?.[activeTier] ?? 'tier_config' : 'binding_mismatch')
          : 'migrated_legacy'
        : args.cfg.llm.contextWindowTokensSource === 'legacy_config'
          ? 'legacy_config'
          : 'none'
  const contextWindowTokens =
    args.cfg.llm.contextWindowTokensSource === 'env_override'
      ? args.cfg.llm.contextWindowTokens
      : contextWindowTokensSource === 'binding_mismatch'
        ? undefined
        : tierContextWindow ?? (contextWindowTokensSource === 'legacy_config' ? args.cfg.llm.contextWindowTokens : undefined)
  const {
    contextWindowTokens: _contextWindowTokens,
    contextWindowTokensBinding: _contextWindowTokensBinding,
    contextWindowTokensBoundModel: _contextWindowTokensBoundModel,
    ...llmBase
  } = args.cfg.llm

  return {
    ...args.cfg,
    llm: {
      ...llmBase,
      defaultTier: activeTier,
      model: modelSelection.model,
      modelSource: modelSelection.source,
      ...(contextWindowTokens != null ? { contextWindowTokens } : {}),
      contextWindowTokensSource,
      ...(bindingMatches &&
      binding &&
      contextWindowTokensSource !== 'env_override' &&
      contextWindowTokensSource !== 'legacy_config'
        ? {
            contextWindowTokensBinding: binding,
            contextWindowTokensBoundModel: binding.model,
          }
        : {}),
      thinkingMode: args.preferences && Object.prototype.hasOwnProperty.call(args.preferences, 'thinkingMode')
        ? Boolean(args.preferences.thinkingMode)
        : args.cfg.llm.thinkingMode,
    },
  }
}

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

export function resolveEffectiveRuntimeModelProfile(args: {
  cfg: RuntimeConfig
  preferences?: ThreadRuntimePreferences
  env?: Record<string, string | undefined>
  runtimeFlagFingerprint?: string
}): RuntimeModelProfile {
  return resolveRuntimeModelProfile({
    cfg: withRuntimePreferences({
      cfg: args.cfg,
      preferences: args.preferences,
      env: args.env,
    }),
    runtimeFlagFingerprint: args.runtimeFlagFingerprint,
  })
}

export function summarizeRuntimeModelProfile(profile: RuntimeModelProfile): EffectiveRuntimeModelProfileSummary {
  return {
    fingerprint: profile.fingerprint,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    authRef: profile.authRef,
    activeTier: profile.activeTier,
    model: profile.model,
    modelSource: profile.modelSource,
    ...(profile.contextWindowTokens != null ? { contextWindowTokens: profile.contextWindowTokens } : {}),
    contextWindowTokensSource: profile.contextWindowTokensSource,
    ...(profile.contextWindowTokensBoundModel ? { contextWindowTokensBoundModel: profile.contextWindowTokensBoundModel } : {}),
    effectiveContextWindowPercent: profile.effectiveContextWindowPercent,
    autoCompactTokenLimitPercent: profile.autoCompactTokenLimitPercent,
    baselineTokens: profile.baselineTokens,
    thinkingMode: profile.thinkingMode,
  }
}
