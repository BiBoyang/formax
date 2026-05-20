import type { ContextBudgetConfig } from './budget'
import {
  executeMiddleLayerStrategyStack,
  type MiddleLayerStrategyFacts,
  type MiddleLayerStrategyStackResult,
} from './middleLayerStrategyStack'
import type { AnthropicCacheEditPlan, PromptBlock, PromptMessage } from '../../prompts'

export type PreparedTurnRequestProjection = {
  persistedHistory: PromptMessage[]
  requestHistory: PromptMessage[]
  requestUser: PromptMessage
  cacheEditPlan: AnthropicCacheEditPlan | null
  stack: MiddleLayerStrategyStackResult
  strategyFacts: MiddleLayerStrategyFacts
}

export function prepareTurnRequestProjection(args: {
  system: PromptBlock[]
  history: PromptMessage[]
  user: PromptMessage
  budgetConfig: ContextBudgetConfig | null
  enableCacheEditing?: boolean
}): PreparedTurnRequestProjection {
  const stack = executeMiddleLayerStrategyStack({
    system: args.system,
    history: args.history,
    trailingMessage: args.user,
    budgetConfig: args.budgetConfig,
    ...(args.enableCacheEditing !== undefined ? { enableCacheEditing: args.enableCacheEditing } : {}),
  })

  return {
    persistedHistory: stack.persistedHistoryCandidate,
    requestHistory: stack.requestHistory,
    requestUser: stack.preparedTrailingMessage ?? args.user,
    cacheEditPlan: stack.cacheEditPlan ?? null,
    stack,
    strategyFacts: stack.facts,
  }
}
