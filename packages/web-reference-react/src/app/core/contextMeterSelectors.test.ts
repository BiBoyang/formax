import { describe, expect, it } from 'vitest'
import { deriveContextMeterView } from './contextMeterSelectors'
import type { ContextMeterThreadRaw } from '../../types'

function baseRaw(): ContextMeterThreadRaw {
  return {
    threadId: 'thread-1',
    budgetRaw: {
      schemaVersion: 1,
      model: 'claude-test',
      provider: 'anthropic',
      contextWindowTokens: 100000,
      effectiveContextWindowPercent: 0.95,
      autoCompactLimitPercent: 0.9,
      baselineTokens: 12000,
      source: 'known_model_window',
    },
    liveUsageByTurnId: {},
  }
}

describe('context meter selectors', () => {
  it('derives live usage with baseline disabled', () => {
    const raw = baseRaw()
    raw.liveUsageByTurnId['turn-1'] = {
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
        output_tokens: 999,
      },
    }

    const view = deriveContextMeterView({ raw, activeTurnId: 'turn-1' })

    expect(view.source).toBe('usage')
    expect(view.usedTokens).toBe(1150)
    expect(view.percentUsed).toBe(1)
    expect(view.label).toContain('usage')
  })

  it('keeps latest completed-turn usage when active turn has cleared', () => {
    const raw = baseRaw()
    raw.latestUsageTurnId = 'turn-1'
    raw.liveUsageByTurnId['turn-1'] = {
      usage: { input_tokens: 1000 },
    }
    raw.snapshot = {
      source: 'context_diagnostics_snapshot',
      fetchedAt: '2026-05-23T00:00:00.000Z',
      totalTokens: 50000,
      systemTokens: 100,
      historyTokens: 49900,
      toolResultTokens: 0,
      otherHistoryTokens: 49900,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolResultBlockCount: 0,
      microCompactedToolResultCount: 0,
    }

    const view = deriveContextMeterView({ raw, activeTurnId: null })

    expect(view.source).toBe('usage')
    expect(view.usedTokens).toBe(1000)
  })

  it('does not fall back to stale usage after a new active turn starts', () => {
    const raw = baseRaw()
    raw.latestUsageTurnId = 'turn-1'
    raw.liveUsageByTurnId['turn-1'] = {
      usage: { input_tokens: 1000 },
    }
    raw.snapshot = {
      source: 'context_diagnostics_snapshot',
      fetchedAt: '2026-05-23T00:00:00.000Z',
      totalTokens: 50000,
      systemTokens: 100,
      historyTokens: 49900,
      toolResultTokens: 0,
      otherHistoryTokens: 49900,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolResultBlockCount: 0,
      microCompactedToolResultCount: 0,
    }

    const view = deriveContextMeterView({ raw, activeTurnId: 'turn-2' })

    expect(view.source).toBe('snapshot')
    expect(view.usedTokens).toBe(50000)
  })

  it('keeps latest usage visible while a new active turn waits for first usage when no snapshot exists', () => {
    const raw = baseRaw()
    raw.latestUsageTurnId = 'turn-1'
    raw.liveUsageByTurnId['turn-1'] = {
      usage: { input_tokens: 1000 },
    }

    const view = deriveContextMeterView({ raw, activeTurnId: 'turn-2' })

    expect(view.source).toBe('usage')
    expect(view.usedTokens).toBe(1000)
  })

  it('does not double-count OpenAI cached prompt tokens for live usage', () => {
    const raw = baseRaw()
    raw.budgetRaw = raw.budgetRaw ? { ...raw.budgetRaw, provider: 'openai' } : raw.budgetRaw
    raw.liveUsageByTurnId['turn-1'] = {
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 400,
      },
    }

    const view = deriveContextMeterView({ raw, activeTurnId: 'turn-1' })

    expect(view.usedTokens).toBe(1000)
  })

  it('derives snapshot usage with normalized baseline', () => {
    const raw = baseRaw()
    raw.snapshot = {
      source: 'context_diagnostics_snapshot',
      fetchedAt: '2026-05-23T00:00:00.000Z',
      totalTokens: 1000,
      systemTokens: 100,
      historyTokens: 900,
      toolResultTokens: 0,
      otherHistoryTokens: 900,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolResultBlockCount: 0,
      microCompactedToolResultCount: 0,
    }

    const view = deriveContextMeterView({ raw, activeTurnId: null })

    expect(view.source).toBe('snapshot')
    expect(view.usedTokens).toBe(1000)
    expect(view.percentUsed).toBe(13)
    expect(view.label).toContain('snapshot')
  })
})
