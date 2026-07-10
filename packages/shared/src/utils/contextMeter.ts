import type { TokenUsage } from '../streaming'

export type ContextMeterBudgetInput = {
  contextWindowTokens: number
  effectiveContextWindowPercent?: number
  autoCompactLimitPercent?: number
  baselineTokens?: number
}

export type ContextMeterBudgetRaw = {
  schemaVersion: 1
  model: string
  provider: string | null
  contextWindowTokens: number
  effectiveContextWindowPercent: number
  autoCompactLimitPercent: number
  baselineTokens: number
  source:
    | 'runtime_config'
    | 'known_model_window'
    | 'env_override'
    | 'tier_config'
    | 'legacy_config'
    | 'migrated_legacy'
    | 'binding_mismatch'
    | 'none'
    | 'provider_list'
    | 'provider_detail'
    | 'catalog'
    | 'heuristic'
    | 'known_model_map'
    | 'manual'
  boundModel?: string | null
  profileFingerprint?: string | null
}

export type ContextMeterBudget = {
  contextWindowTokens: number
  effectiveLimitTokens: number
  autoCompactLimitTokens: number
}

export type ContextMeterStats = ContextMeterBudget & {
  usedTokens: number
  percentRemaining: number
  shouldAutoCompact: boolean
}

export const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 0.95
export const DEFAULT_AUTO_COMPACT_LIMIT_PERCENT = 0.9
export const DEFAULT_CONTEXT_BASELINE_TOKENS = 12000

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export function normalizeContextMeterBudgetRaw(args: {
  model: string
  provider?: string | null
  source: ContextMeterBudgetRaw['source']
  boundModel?: string | null
  profileFingerprint?: string | null
  config: ContextMeterBudgetInput
}): ContextMeterBudgetRaw {
  return {
    schemaVersion: 1,
    model: args.model,
    provider: args.provider ?? null,
    contextWindowTokens: clampInt(args.config.contextWindowTokens, 1, Number.MAX_SAFE_INTEGER),
    effectiveContextWindowPercent:
      args.config.effectiveContextWindowPercent ?? DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
    autoCompactLimitPercent: args.config.autoCompactLimitPercent ?? DEFAULT_AUTO_COMPACT_LIMIT_PERCENT,
    baselineTokens: clampInt(args.config.baselineTokens ?? DEFAULT_CONTEXT_BASELINE_TOKENS, 0, Number.MAX_SAFE_INTEGER),
    source: args.source,
    ...(args.boundModel ? { boundModel: args.boundModel } : {}),
    ...(args.profileFingerprint ? { profileFingerprint: args.profileFingerprint } : {}),
  }
}

export function computeContextMeterBudget(config: ContextMeterBudgetInput): ContextMeterBudget {
  const window = clampInt(config.contextWindowTokens, 1, Number.MAX_SAFE_INTEGER)
  const effectivePct = config.effectiveContextWindowPercent ?? DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  const autoCompactPct = config.autoCompactLimitPercent ?? DEFAULT_AUTO_COMPACT_LIMIT_PERCENT

  const effectiveLimitTokens = clampInt(Math.floor(window * effectivePct), 1, window)
  const autoCompactLimitTokens = clampInt(
    Math.floor(effectiveLimitTokens * autoCompactPct),
    1,
    effectiveLimitTokens,
  )

  return {
    contextWindowTokens: window,
    effectiveLimitTokens,
    autoCompactLimitTokens,
  }
}

export function computeContextMeterStats(args: {
  config: ContextMeterBudgetInput
  usedTokens: number | null | undefined
}): ContextMeterStats {
  const budget = computeContextMeterBudget(args.config)
  const rawBaseline = clampInt(args.config.baselineTokens ?? DEFAULT_CONTEXT_BASELINE_TOKENS, 0, Number.MAX_SAFE_INTEGER)
  const baseline = rawBaseline < budget.effectiveLimitTokens ? rawBaseline : 0
  const used = clampInt(args.usedTokens ?? 0, 0, Number.MAX_SAFE_INTEGER)

  const usedForPercent = Math.max(used, baseline)
  const pctUsed = clampInt(
    Math.round((usedForPercent * 100) / Math.max(1, budget.effectiveLimitTokens)),
    0,
    100,
  )
  const percentRemaining = 100 - pctUsed

  return {
    ...budget,
    usedTokens: used,
    percentRemaining,
    shouldAutoCompact: used >= budget.autoCompactLimitTokens,
  }
}

export function sumInputTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

export function sumContextMeterLiveInputTokens(args: {
  usage: TokenUsage | undefined
  provider?: string | null
}): number {
  const u = args.usage || {}
  if (String(args.provider ?? '').toLowerCase() === 'openai') {
    return u.input_tokens ?? 0
  }
  return sumInputTokens(args.usage)
}
