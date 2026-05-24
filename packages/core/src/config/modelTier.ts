import type { ModelSource, ModelTier } from '../config/settings/schema.js'
export type { ModelTier } from '../config/settings/schema.js'

const DEFAULT_MODEL_BY_TIER: Record<ModelTier, string> = {
  haiku: 'claude-3-5-haiku-latest',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-3-opus-latest',
}

const ENV_KEY_BY_TIER: Record<ModelTier, keyof NodeJS.ProcessEnv> = {
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
}

function normalizeNonEmptyString(value: string | null | undefined): string {
  return String(value || '').trim()
}

export function parseModelTier(raw: string | null | undefined): ModelTier | null {
  const value = normalizeNonEmptyString(raw).toLowerCase()
  if (value === 'haiku' || value === 'sonnet' || value === 'opus') return value
  return null
}

export function normalizeModelTier(raw: string | null | undefined, fallback: ModelTier = 'sonnet'): ModelTier {
  return parseModelTier(raw) ?? fallback
}

export function resolveModelForTier(args: {
  tier: ModelTier
  env?: Record<string, string | undefined>
  configuredModel?: string
  configuredTierModels?: Partial<Record<ModelTier, string>>
}): string {
  return resolveModelSelectionForTier(args).model
}

export function resolveModelSelectionForTier(args: {
  tier: ModelTier
  env?: Record<string, string | undefined>
  configuredModel?: string
  configuredTierModels?: Partial<Record<ModelTier, string>>
}): { model: string; source: ModelSource } {
  const env = args.env ?? process.env
  const key = ENV_KEY_BY_TIER[args.tier]
  const fromEnv = normalizeNonEmptyString(env[key])
  if (fromEnv) return { model: fromEnv, source: 'tier_env' }

  // Preserve legacy behavior: llm.model can always override sonnet.
  if (args.tier === 'sonnet') {
    const configured = normalizeNonEmptyString(args.configuredModel)
    if (configured) return { model: configured, source: 'legacy_sonnet_model' }
  }

  const fromConfigMap = normalizeNonEmptyString(args.configuredTierModels?.[args.tier])
  if (fromConfigMap) return { model: fromConfigMap, source: 'tier_model' }

  return { model: DEFAULT_MODEL_BY_TIER[args.tier], source: 'default_model' }
}

export function resolveActiveModel(args: {
  defaultTierRaw?: string | null
  configuredModel?: string
  configuredTierModels?: Partial<Record<ModelTier, string>>
  env?: Record<string, string | undefined>
}): { defaultTier: ModelTier; model: string; modelSource: ModelSource } {
  const defaultTier = normalizeModelTier(args.defaultTierRaw, 'sonnet')
  const selection = resolveModelSelectionForTier({
    tier: defaultTier,
    configuredModel: args.configuredModel,
    configuredTierModels: args.configuredTierModels,
    env: args.env,
  })
  return {
    defaultTier,
    model: selection.model,
    modelSource: selection.source,
  }
}
