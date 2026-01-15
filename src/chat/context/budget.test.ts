import { describe, expect, it } from 'vitest'
import { computeContextBudget, computeContextStats } from './budget'

describe('context budget', () => {
  it('computes effective and auto-compact limits', () => {
    const budget = computeContextBudget({
      contextWindowTokens: 200_000,
      effectiveContextWindowPercent: 0.95,
      autoCompactLimitPercent: 0.9,
    })

    expect(budget.contextWindowTokens).toBe(200_000)
    expect(budget.effectiveLimitTokens).toBe(190_000)
    expect(budget.autoCompactLimitTokens).toBe(171_000)
  })

  it('clamps invalid inputs', () => {
    const budget = computeContextBudget({
      contextWindowTokens: Number.NaN,
      effectiveContextWindowPercent: 2,
      autoCompactLimitPercent: -1,
    })

    expect(budget.contextWindowTokens).toBe(1)
    expect(budget.effectiveLimitTokens).toBe(1)
    expect(budget.autoCompactLimitTokens).toBe(1)
  })

  it('uses baseline tokens for percentRemaining', () => {
    const stats = computeContextStats({
      config: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 1,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 12_000,
      },
      usedTokens: 100,
    })

    expect(stats.percentRemaining).toBe(88)
    expect(stats.shouldAutoCompact).toBe(false)
  })

  it('triggers auto-compact when used exceeds limit', () => {
    const stats = computeContextStats({
      config: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 1,
        autoCompactLimitPercent: 0.9,
      },
      usedTokens: 90_000,
    })
    expect(stats.shouldAutoCompact).toBe(true)
  })

  it('ignores baseline when it exceeds the window', () => {
    const stats = computeContextStats({
      config: { contextWindowTokens: 8_000, effectiveContextWindowPercent: 1, baselineTokens: 12_000 },
      usedTokens: 0,
    })
    expect(stats.percentRemaining).toBe(100)
  })
})
