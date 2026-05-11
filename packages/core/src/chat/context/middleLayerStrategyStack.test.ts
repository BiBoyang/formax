import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMiddleLayerStrategyStack } from './middleLayerStrategyStack'
import { computeContextStats } from './budget'
import { estimatePromptTokens } from './estimate'
import { microCompactHistory, resolveAdaptiveMicroCompactPolicy } from './microCompact'
import { pruneForPromptBudget } from './prune'
import { collapseRequestHistory } from './contextCollapse'
import { applyToolResultBudget, resolveAdaptiveToolResultBudgetPolicy } from './toolResultBudget'

vi.mock('./budget', () => ({
  computeContextStats: vi.fn(),
}))

vi.mock('./estimate', () => ({
  estimatePromptTokens: vi.fn(),
}))

vi.mock('./microCompact', () => ({
  microCompactHistory: vi.fn(),
  resolveAdaptiveMicroCompactPolicy: vi.fn(),
}))

vi.mock('./prune', () => ({
  pruneForPromptBudget: vi.fn(),
}))

vi.mock('./contextCollapse', () => ({
  collapseRequestHistory: vi.fn(),
}))

vi.mock('./toolResultBudget', () => ({
  applyToolResultBudget: vi.fn(),
  resolveAdaptiveToolResultBudgetPolicy: vi.fn(),
}))

describe('executeMiddleLayerStrategyStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAdaptiveMicroCompactPolicy).mockReturnValue({
      pressureTier: 'tight',
      eligibleToolNames: ['Read', 'Grep'],
      keepRecentToolResults: 2,
      keepRecentToolResultsByName: { Read: 1 },
      minResultChars: 1200,
      minResultCharsByName: { Grep: 900 },
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
    })
    vi.mocked(resolveAdaptiveToolResultBudgetPolicy).mockReturnValue({
      pressureTier: 'tight',
      eligibleToolNames: ['Read', 'Grep', 'Glob'],
      keepRecentToolResults: 1,
      minResultChars: 900,
      minResultCharsByName: { Grep: 700 },
      maxToolResultTokens: 2600,
    })
    vi.mocked(computeContextStats).mockReturnValue({
      effectiveLimitTokens: 1000,
      usedTokens: 500,
    } as any)
    vi.mocked(estimatePromptTokens)
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(900)
      .mockReturnValueOnce(700)
  })

  it('runs reducers before collapse and keeps prune as terminal fallback', () => {
    const compactedHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'microcompacted-history' }] }] as any
    const collapsedHistory = [{ role: 'user', content: [{ type: 'text', text: 'request-recap' }] }] as any
    const prunedMessages = [...collapsedHistory, { role: 'user', content: [{ type: 'text', text: 'pruned-user' }] }] as any
    vi.mocked(microCompactHistory).mockReturnValue({
      messages: compactedHistory,
      compacted: true,
      compactedBlocks: 2,
      compactedToolNames: ['Read'],
      estimatedTokensSaved: 300,
      keptRecentBlocks: 1,
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
      cacheAwareCompactedBlocks: 1,
      cacheAwareToolNames: ['Grep'],
    } as any)
    vi.mocked(applyToolResultBudget).mockReturnValue({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'budgeted-result' }] }],
      applied: true,
      impact: {
        replacedBlocks: 1,
        replacedToolNames: ['Read'],
        estimatedTokensSaved: 180,
        keptRecentBlocks: 2,
        budgetTokens: 2600,
        totalToolResultTokensBefore: 3200,
        totalToolResultTokensAfter: 3020,
      },
    } as any)
    vi.mocked(collapseRequestHistory).mockReturnValue({
      messages: collapsedHistory,
      collapsed: true,
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 220,
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        preservedTailMessageCount: 1,
        retainedCompactSummary: false,
        recentUserPromptCount: 1,
        recentFileCount: 0,
        earlierToolResultBlockCount: 2,
        recapFingerprint: 'fp-1',
      },
    } as any)
    vi.mocked(pruneForPromptBudget).mockReturnValue({
      messages: prunedMessages,
      pruned: true,
    } as any)

    const result = executeMiddleLayerStrategyStack({
      system: [{ type: 'text', text: 'sys' }],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }] as any,
      trailingMessage: { role: 'user', content: [{ type: 'text', text: 'next' }] } as any,
      budgetConfig: {
        contextWindowTokens: 10000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.85,
        baselineTokens: 1000,
      },
    })

    expect(resolveAdaptiveMicroCompactPolicy).toHaveBeenCalledWith({ pressureRatio: 0.5 })
    expect(resolveAdaptiveToolResultBudgetPolicy).toHaveBeenCalledWith({
      pressureRatio: 0.5,
      budgetConfig: {
        contextWindowTokens: 10000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.85,
        baselineTokens: 1000,
      },
    })
    expect(vi.mocked(microCompactHistory).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(applyToolResultBudget).mock.invocationCallOrder[0]!,
    )
    expect(vi.mocked(applyToolResultBudget).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(collapseRequestHistory).mock.invocationCallOrder[0]!,
    )
    expect(vi.mocked(collapseRequestHistory).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(pruneForPromptBudget).mock.invocationCallOrder[0]!,
    )
    expect(result.persistedHistoryCandidate).toEqual(compactedHistory)
    expect(result.toolBudgetedHistory).toEqual([{ role: 'user', content: [{ type: 'text', text: 'budgeted-result' }] }])
    expect(result.collapsedHistory).toEqual(collapsedHistory)
    expect(result.preparedTrailingMessage).toEqual(prunedMessages[1])
    expect(result.requestHistory).toEqual(collapsedHistory)
    expect(result.facts).toEqual({
      toolResultBudget: {
        stage: 'tool_result_budget',
        role: 'budget_reducer',
        scope: 'request_history_projection',
        applied: true,
        pressureRatio: 0.5,
        policy: {
          pressureTier: 'tight',
          eligibleToolNames: ['Read', 'Grep', 'Glob'],
          keepRecentToolResults: 1,
          minResultChars: 900,
          minResultCharsByName: { Grep: 700 },
          maxToolResultTokens: 2600,
        },
        impact: {
          replacedBlocks: 1,
          replacedToolNames: ['Read'],
          estimatedTokensSaved: 180,
          keptRecentBlocks: 2,
          budgetTokens: 2600,
          totalToolResultTokensBefore: 3200,
          totalToolResultTokensAfter: 3020,
        },
      },
      microCompact: {
        stage: 'microcompact',
        role: 'budget_reducer',
        scope: 'persisted_history_candidate',
        applied: true,
        pressureRatio: 0.5,
        policy: {
          pressureTier: 'tight',
          eligibleToolNames: ['Read', 'Grep'],
          keepRecentToolResults: 2,
          keepRecentToolResultsByName: { Read: 1 },
          minResultChars: 1200,
          minResultCharsByName: { Grep: 900 },
          cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
          cacheAwareMinResultChars: 400,
        },
        impact: {
          compactedBlocks: 2,
          compactedToolNames: ['Read'],
          estimatedTokensSaved: 300,
          keptRecentBlocks: 1,
          cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
          cacheAwareMinResultChars: 400,
          cacheAwareCompactedBlocks: 1,
          cacheAwareToolNames: ['Grep'],
        },
      },
      prune: {
        stage: 'prune',
        role: 'terminal_fallback',
        scope: 'assembled_request_envelope',
        applied: true,
        totalTokensBeforePrune: 900,
        totalTokensAfterPrune: 700,
        messageCountBeforePrune: 2,
        messageCountAfterPrune: 2,
      },
      collapse: {
        stage: 'collapse',
        role: 'semantic_projection',
        scope: 'request_history_projection',
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 220,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          preservedTailMessageCount: 1,
          retainedCompactSummary: false,
          recentUserPromptCount: 1,
          recentFileCount: 0,
          earlierToolResultBlockCount: 2,
          recapFingerprint: 'fp-1',
        },
      },
    })
  })

  it('can skip collapse and prune while still returning a unified strategy shape', () => {
    vi.mocked(estimatePromptTokens).mockReset()
    vi.mocked(estimatePromptTokens).mockReturnValue(400)
    vi.mocked(resolveAdaptiveMicroCompactPolicy).mockReturnValue({
      pressureTier: 'default',
      eligibleToolNames: ['Read'],
      keepRecentToolResults: 3,
      keepRecentToolResultsByName: {},
      minResultChars: 1200,
      minResultCharsByName: {},
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
    })
    vi.mocked(resolveAdaptiveToolResultBudgetPolicy).mockReturnValue({
      pressureTier: 'default',
      eligibleToolNames: ['Read', 'Grep', 'Glob'],
      keepRecentToolResults: 1,
      minResultChars: 900,
      minResultCharsByName: { Grep: 700 },
      maxToolResultTokens: null,
    })
    vi.mocked(microCompactHistory).mockReturnValue({
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }],
      compacted: false,
      compactedBlocks: 0,
      compactedToolNames: [],
      estimatedTokensSaved: 0,
      keptRecentBlocks: 0,
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
      cacheAwareCompactedBlocks: 0,
      cacheAwareToolNames: [],
    } as any)
    vi.mocked(applyToolResultBudget).mockReturnValue({
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }],
      applied: false,
      impact: {
        replacedBlocks: 0,
        replacedToolNames: [],
        estimatedTokensSaved: 0,
        keptRecentBlocks: 0,
        budgetTokens: null,
        totalToolResultTokensBefore: 0,
        totalToolResultTokensAfter: 0,
      },
    } as any)

    const result = executeMiddleLayerStrategyStack({
      system: [{ type: 'text', text: 'sys' }],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }] as any,
      budgetConfig: null,
      enableCollapse: false,
    })

    expect(pruneForPromptBudget).not.toHaveBeenCalled()
    expect(collapseRequestHistory).not.toHaveBeenCalled()
    expect(result.persistedHistoryCandidate).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }])
    expect(result.toolBudgetedHistory).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }])
    expect(result.collapsedHistory).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }])
    expect(result.requestHistory).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }])
    expect(result.facts.toolResultBudget).toEqual({
      stage: 'tool_result_budget',
      role: 'budget_reducer',
      scope: 'request_history_projection',
      applied: false,
      pressureRatio: null,
      policy: {
        pressureTier: 'default',
        eligibleToolNames: ['Read', 'Grep', 'Glob'],
        keepRecentToolResults: 1,
        minResultChars: 900,
        minResultCharsByName: { Grep: 700 },
        maxToolResultTokens: null,
      },
      impact: {
        replacedBlocks: 0,
        replacedToolNames: [],
        estimatedTokensSaved: 0,
        keptRecentBlocks: 0,
        budgetTokens: null,
        totalToolResultTokensBefore: 0,
        totalToolResultTokensAfter: 0,
      },
    })
    expect(result.facts.microCompact).toEqual(
      expect.objectContaining({
        stage: 'microcompact',
        role: 'budget_reducer',
        scope: 'persisted_history_candidate',
        pressureRatio: null,
      }),
    )
    expect(result.facts.prune).toEqual(
      expect.objectContaining({
        stage: 'prune',
        role: 'terminal_fallback',
        scope: 'assembled_request_envelope',
        applied: false,
      }),
    )
    expect(result.facts.collapse).toEqual({
      stage: 'collapse',
      role: 'semantic_projection',
      scope: 'request_history_projection',
      applied: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    })
  })
})
