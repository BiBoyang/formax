import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAutoCompactKeepStrategy, buildCompactBoundaryMessage, buildCompactionSummaryUserText } from './compact'
import { executeMiddleLayerStrategyStack } from './middleLayerStrategyStack'
import { prepareTurnRequestProjection } from './turnRequestProjection'
import type { PromptMessage } from '../../prompts'

vi.mock('./middleLayerStrategyStack', () => ({
  executeMiddleLayerStrategyStack: vi.fn(),
}))

describe('prepareTurnRequestProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function textMessage(role: 'user' | 'assistant', text: string): PromptMessage {
    return { role, content: [{ type: 'text', text }] }
  }

  function compactBoundary(): PromptMessage {
    return buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 8192,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
  }

  it('returns persisted history, request history, and request user from the canonical stack', () => {
    const stackPersistedHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'stack-persisted' }] }]
    const requestHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'request-only' }] }]
    const requestUser = { role: 'user', content: [{ type: 'text', text: 'request-user' }] }
    const facts = { stageOrder: ['microcompact', 'tool_result_budget', 'snip', 'collapse', 'prune'] }
    vi.mocked(executeMiddleLayerStrategyStack).mockReturnValue({
      persistedHistoryCandidate: stackPersistedHistory,
      requestHistory,
      preparedTrailingMessage: requestUser,
      cacheEditPlan: { provider: 'anthropic', deletes: [] },
      facts,
    } as any)

    const user = { role: 'user', content: [{ type: 'text', text: 'original-user' }] }
    const history = [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }]
    const out = prepareTurnRequestProjection({
      system: [{ type: 'text', text: 'sys' }],
      history,
      user,
      budgetConfig: null,
      enableCacheEditing: true,
    } as any)

    expect(executeMiddleLayerStrategyStack).toHaveBeenCalledWith({
      system: [{ type: 'text', text: 'sys' }],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }],
      trailingMessage: user,
      budgetConfig: null,
      enableCacheEditing: true,
    })
    expect(out.persistedHistory).toBe(history)
    expect(out.requestHistory).toBe(requestHistory)
    expect(out.requestUser).toBe(requestUser)
    expect(out.cacheEditPlan).toEqual({ provider: 'anthropic', deletes: [] })
    expect(out.contextProjection.rawTranscript).toBe(history)
    expect(out.contextProjection.modelFacingBaseline).toBe(history)
    expect(out.strategyFacts).toBe(facts)
  })

  it('falls back to the original user when the terminal stack does not rewrite the trailing message', () => {
    const user = { role: 'user', content: [{ type: 'text', text: 'original-user' }] }
    vi.mocked(executeMiddleLayerStrategyStack).mockReturnValue({
      persistedHistoryCandidate: [],
      requestHistory: [],
      preparedTrailingMessage: null,
      facts: {},
    } as any)

    const out = prepareTurnRequestProjection({
      system: [],
      history: [],
      user,
      budgetConfig: null,
    } as any)

    expect(out.requestUser).toBe(user)
  })

  it('uses the compact-boundary continuation as the model-facing stack input while preserving raw history', () => {
    const history: PromptMessage[] = [
      textMessage('user', 'pre-boundary request'),
      textMessage('assistant', 'pre-boundary answer'),
      compactBoundary(),
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('assistant', 'post-boundary answer'),
    ]
    const user = textMessage('user', 'next request')
    vi.mocked(executeMiddleLayerStrategyStack).mockReturnValue({
      persistedHistoryCandidate: history.slice(3),
      requestHistory: history.slice(3),
      preparedTrailingMessage: user,
      cacheEditPlan: null,
      facts: {},
    } as any)

    const out = prepareTurnRequestProjection({
      system: [],
      history,
      user,
      budgetConfig: null,
    })

    expect(executeMiddleLayerStrategyStack).toHaveBeenCalledWith({
      system: [],
      history: [
        textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
        textMessage('assistant', 'post-boundary answer'),
      ],
      trailingMessage: user,
      budgetConfig: null,
      allowBoundarylessContinuation: true,
    })
    expect(out.persistedHistory).toBe(history)
    expect(out.contextProjection.rawTranscript).toBe(history)
    expect(out.contextProjection.modelFacingBaseline).toEqual([
      textMessage('user', buildCompactionSummaryUserText('Compacted summary')),
      textMessage('assistant', 'post-boundary answer'),
    ])
  })

  it('applies durable snip state before request-only reducers without mutating persisted history', () => {
    const history: PromptMessage[] = [
      textMessage('assistant', 'keep-before-snip'),
      textMessage('assistant', 'remove-middle'),
      textMessage('assistant', 'keep-after-snip'),
    ]
    const user = textMessage('user', 'continue')
    vi.mocked(executeMiddleLayerStrategyStack).mockReturnValue({
      persistedHistoryCandidate: [history[0], history[2]],
      requestHistory: [history[0], history[2]],
      preparedTrailingMessage: null,
      cacheEditPlan: null,
      facts: {},
    } as any)

    const out = prepareTurnRequestProjection({
      system: [],
      history,
      user,
      budgetConfig: null,
      durableState: {
        snip: {
          schemaVersion: 1,
          removals: [{ kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 2 }],
        },
      },
    })

    expect(executeMiddleLayerStrategyStack).toHaveBeenCalledWith({
      system: [],
      history: [history[0], history[2]],
      trailingMessage: user,
      budgetConfig: null,
    })
    expect(out.persistedHistory).toBe(history)
    expect(out.requestHistory).toEqual([history[0], history[2]])
    expect(out.contextProjection.facts.appliedDurableStages).toEqual(['snip'])
    expect(out.contextProjection.durableState.snip).toMatchObject({
      status: 'active',
      applied: true,
      removedMessageCount: 1,
      droppedOrphanToolBlockCount: 0,
    })
  })
})
