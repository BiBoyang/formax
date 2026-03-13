import type { ModelTier } from '../config/settings/schema.js'
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
  const env = args.env ?? process.env
  const key = ENV_KEY_BY_TIER[args.tier]
  const fromEnv = normalizeNonEmptyString(env[key])
  if (fromEnv) return fromEnv

  // Preserve legacy behavior: llm.model can always override sonnet.
  if (args.tier === 'sonnet') {
    const configured = normalizeNonEmptyString(args.configuredModel)
    if (configured) return configured
  }

  const fromConfigMap = normalizeNonEmptyString(args.configuredTierModels?.[args.tier])
  if (fromConfigMap) return fromConfigMap

  return DEFAULT_MODEL_BY_TIER[args.tier]
}

export function resolveActiveModel(args: {
  defaultTierRaw?: string | null
  configuredModel?: string
  configuredTierModels?: Partial<Record<ModelTier, string>>
  env?: Record<string, string | undefined>
}): { defaultTier: ModelTier; model: string } {
  const defaultTier = normalizeModelTier(args.defaultTierRaw, 'sonnet')
  return {
    defaultTier,
    model: resolveModelForTier({
      tier: defaultTier,
      configuredModel: args.configuredModel,
      configuredTierModels: args.configuredTierModels,
      env: args.env,
    }),
  }
}
