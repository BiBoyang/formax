import type {
  CapabilityConfidence,
  CapabilitySource,
  ConfigBudgetSource,
  ModelIdentity,
  ModelSource,
  ProviderId,
} from '../../config/settings/schema.js'

export type ModelContextWindowMetadata = {
  tokens: number
  source: CapabilitySource
  confidence: CapabilityConfidence
  binding: ModelIdentity
}

export type RuntimeModelProfile = {
  fingerprint: string
  provider: ProviderId
  baseUrl: string
  authRef: string
  activeTier: 'haiku' | 'sonnet' | 'opus'
  model: string
  modelSource: ModelSource
  contextWindowTokens?: number
  contextWindowTokensSource: ConfigBudgetSource | CapabilitySource
  contextWindowTokensBoundModel?: string
  contextWindowTokensBinding?: ModelIdentity
  effectiveContextWindowPercent: number
  autoCompactTokenLimitPercent: number
  baselineTokens: number
  thinkingMode: boolean
}

export function normalizeIdentityBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

export function normalizeModelIdentity(args: {
  provider: ProviderId
  baseUrl: string
  model: string
}): ModelIdentity {
  return {
    provider: args.provider,
    baseUrl: normalizeIdentityBaseUrl(args.baseUrl),
    model: String(args.model || '').trim(),
  }
}

export function sameModelIdentity(left: ModelIdentity | null | undefined, right: ModelIdentity | null | undefined): boolean {
  if (!left || !right) return false
  return (
    left.provider === right.provider &&
    normalizeIdentityBaseUrl(left.baseUrl) === normalizeIdentityBaseUrl(right.baseUrl) &&
    String(left.model || '').trim() === String(right.model || '').trim()
  )
}

export function createModelContextWindowMetadata(args: {
  provider: ProviderId
  baseUrl: string
  model: string
  tokens: number
  source: CapabilitySource
  confidence: CapabilityConfidence
}): ModelContextWindowMetadata {
  return {
    tokens: Math.round(args.tokens),
    source: args.source,
    confidence: args.confidence,
    binding: normalizeModelIdentity({
      provider: args.provider,
      baseUrl: args.baseUrl,
      model: args.model,
    }),
  }
}

export function shouldPersistContextWindowSource(source: CapabilitySource): boolean {
  return source !== 'heuristic'
}

export function buildOpaqueFingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildRuntimeModelProfileFingerprint(args: {
  provider: ProviderId
  baseUrl: string
  authRef: string
  apiKey: string
  timeoutMs: number
  activeTier: 'haiku' | 'sonnet' | 'opus'
  model: string
  modelSource: ModelSource
  contextWindowTokens?: number
  contextWindowTokensSource: ConfigBudgetSource | CapabilitySource
  contextWindowTokensBinding?: ModelIdentity
  effectiveContextWindowPercent: number
  autoCompactTokenLimitPercent: number
  baselineTokens: number
  thinkingMode: boolean
  runtimeFlagFingerprint?: string
}): string {
  return JSON.stringify({
    provider: args.provider,
    baseUrl: normalizeIdentityBaseUrl(args.baseUrl),
    authRef: String(args.authRef || '').trim(),
    apiKeyFingerprint: buildOpaqueFingerprint(String(args.apiKey || '')),
    timeoutMs: args.timeoutMs,
    activeTier: args.activeTier,
    model: String(args.model || '').trim(),
    modelSource: args.modelSource,
    contextWindowTokens: args.contextWindowTokens ?? null,
    contextWindowTokensSource: args.contextWindowTokensSource,
    contextWindowTokensBinding: args.contextWindowTokensBinding
      ? normalizeModelIdentity({
          provider: args.contextWindowTokensBinding.provider,
          baseUrl: args.contextWindowTokensBinding.baseUrl,
          model: args.contextWindowTokensBinding.model,
        })
      : null,
    effectiveContextWindowPercent: args.effectiveContextWindowPercent,
    autoCompactTokenLimitPercent: args.autoCompactTokenLimitPercent,
    baselineTokens: args.baselineTokens,
    thinkingMode: args.thinkingMode,
    runtimeFlagFingerprint: args.runtimeFlagFingerprint ?? '',
  })
}
