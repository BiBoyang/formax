import {
  computeContextMeterStats,
  sumContextMeterLiveInputTokens,
  type ContextMeterBudgetInput,
} from '@formax/shared/utils/contextMeter'
import type { AppState } from '../../store'
import type { ContextMeterThreadRaw, ContextMeterView } from '../../types'

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}m`
}

function emptyView(): ContextMeterView {
  return {
    available: false,
    source: null,
    usedTokens: null,
    limitTokens: null,
    percentUsed: null,
    percentRemaining: null,
    shouldAutoCompact: null,
    label: null,
    tone: 'normal',
  }
}

function toneFor(percentUsed: number): ContextMeterView['tone'] {
  if (percentUsed >= 90) return 'danger'
  if (percentUsed >= 75) return 'warning'
  return 'normal'
}

function toBudgetInput(raw: ContextMeterThreadRaw['budgetRaw']): ContextMeterBudgetInput | null {
  if (!raw) return null
  return {
    contextWindowTokens: raw.contextWindowTokens,
    effectiveContextWindowPercent: raw.effectiveContextWindowPercent,
    autoCompactLimitPercent: raw.autoCompactLimitPercent,
    baselineTokens: raw.baselineTokens,
  }
}

export function deriveContextMeterView(args: {
  raw: ContextMeterThreadRaw | null | undefined
  activeTurnId: string | null
}): ContextMeterView {
  const budgetInput = toBudgetInput(args.raw?.budgetRaw ?? null)
  if (!args.raw || !budgetInput) return emptyView()

  const liveTurnId = args.activeTurnId
    ? args.raw.liveUsageByTurnId[args.activeTurnId]
      ? args.activeTurnId
      : null
    : args.raw.latestUsageTurnId ?? null
  const fallbackLatestUsageTurnId = args.raw.latestUsageTurnId ?? null
  const liveUsage = liveTurnId ? args.raw.liveUsageByTurnId[liveTurnId] : undefined
  const fallbackLatestUsage = !liveUsage && !args.raw.snapshot && fallbackLatestUsageTurnId
    ? args.raw.liveUsageByTurnId[fallbackLatestUsageTurnId]
    : undefined
  const usageForDisplay = liveUsage ?? fallbackLatestUsage
  if (usageForDisplay) {
    const stats = computeContextMeterStats({
      config: { ...budgetInput, baselineTokens: 0 },
      usedTokens: sumContextMeterLiveInputTokens({
        usage: usageForDisplay.usage,
        provider: args.raw.budgetRaw?.provider,
      }),
    })
    const percentUsed = 100 - stats.percentRemaining
    return {
      available: true,
      source: 'usage',
      usedTokens: stats.usedTokens,
      limitTokens: stats.effectiveLimitTokens,
      percentUsed,
      percentRemaining: stats.percentRemaining,
      shouldAutoCompact: stats.shouldAutoCompact,
      label: `${percentUsed}% used (${formatTokens(stats.usedTokens)}/${formatTokens(stats.effectiveLimitTokens)}, usage)`,
      tone: toneFor(percentUsed),
    }
  }

  if (args.raw.snapshot) {
    const stats = computeContextMeterStats({
      config: budgetInput,
      usedTokens: args.raw.snapshot.totalTokens,
    })
    const percentUsed = 100 - stats.percentRemaining
    return {
      available: true,
      source: 'snapshot',
      usedTokens: stats.usedTokens,
      limitTokens: stats.effectiveLimitTokens,
      percentUsed,
      percentRemaining: stats.percentRemaining,
      shouldAutoCompact: stats.shouldAutoCompact,
      label: `${percentUsed}% used (${formatTokens(stats.usedTokens)}/${formatTokens(stats.effectiveLimitTokens)}, snapshot)`,
      tone: toneFor(percentUsed),
    }
  }

  return emptyView()
}

export function selectActiveContextMeterView(state: AppState): ContextMeterView {
  const threadId = state.activeThreadId
  return deriveContextMeterView({
    raw: threadId ? state.contextMeterRawByThreadId[threadId] : null,
    activeTurnId: state.activeTurnId,
  })
}
