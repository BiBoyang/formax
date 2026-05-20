import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMiddleLayerStrategyStack } from './middleLayerStrategyStack'
import { prepareTurnRequestProjection } from './turnRequestProjection'

vi.mock('./middleLayerStrategyStack', () => ({
  executeMiddleLayerStrategyStack: vi.fn(),
}))

describe('prepareTurnRequestProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns persisted history, request history, and request user from the canonical stack', () => {
    const persistedHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'persisted' }] }]
    const requestHistory = [{ role: 'assistant', content: [{ type: 'text', text: 'request-only' }] }]
    const requestUser = { role: 'user', content: [{ type: 'text', text: 'request-user' }] }
    const facts = { stageOrder: ['microcompact', 'tool_result_budget', 'snip', 'collapse', 'prune'] }
    vi.mocked(executeMiddleLayerStrategyStack).mockReturnValue({
      persistedHistoryCandidate: persistedHistory,
      requestHistory,
      preparedTrailingMessage: requestUser,
      cacheEditPlan: { provider: 'anthropic', deletes: [] },
      facts,
    } as any)

    const user = { role: 'user', content: [{ type: 'text', text: 'original-user' }] }
    const out = prepareTurnRequestProjection({
      system: [{ type: 'text', text: 'sys' }],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'history' }] }],
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
    expect(out.persistedHistory).toBe(persistedHistory)
    expect(out.requestHistory).toBe(requestHistory)
    expect(out.requestUser).toBe(requestUser)
    expect(out.cacheEditPlan).toEqual({ provider: 'anthropic', deletes: [] })
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
})
