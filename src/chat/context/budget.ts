export type ContextBudgetConfig = {
  contextWindowTokens: number
  effectiveContextWindowPercent?: number
  autoCompactLimitPercent?: number
  baselineTokens?: number
}

export type ContextBudget = {
  contextWindowTokens: number
  effectiveLimitTokens: number
  autoCompactLimitTokens: number
}

export type ContextStats = ContextBudget & {
  usedTokens: number
  percentRemaining: number
  shouldAutoCompact: boolean
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export function computeContextBudget(config: ContextBudgetConfig): ContextBudget {
  const window = clampInt(config.contextWindowTokens, 1, Number.MAX_SAFE_INTEGER)
  const effectivePct = config.effectiveContextWindowPercent ?? 0.95
  const autoCompactPct = config.autoCompactLimitPercent ?? 0.9

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

export function computeContextStats(args: {
  config: ContextBudgetConfig
  usedTokens: number | null | undefined
}): ContextStats {
  const budget = computeContextBudget(args.config)
  const rawBaseline = clampInt(args.config.baselineTokens ?? 12000, 0, Number.MAX_SAFE_INTEGER)
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
