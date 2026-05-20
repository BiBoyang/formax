import type { ContextBudgetConfig } from './budget'
import {
  executeMiddleLayerStrategyStack,
  type MiddleLayerStrategyFacts,
  type MiddleLayerStrategyStackResult,
} from './middleLayerStrategyStack'
import type { PromptBlock, PromptMessage } from '../../prompts'

export type PreparedTurnRequestProjection = {
  persistedHistory: PromptMessage[]
  requestHistory: PromptMessage[]
  requestUser: PromptMessage
  stack: MiddleLayerStrategyStackResult
  strategyFacts: MiddleLayerStrategyFacts
}

export function prepareTurnRequestProjection(args: {
  system: PromptBlock[]
  history: PromptMessage[]
  user: PromptMessage
  budgetConfig: ContextBudgetConfig | null
}): PreparedTurnRequestProjection {
  const stack = executeMiddleLayerStrategyStack({
    system: args.system,
    history: args.history,
    trailingMessage: args.user,
    budgetConfig: args.budgetConfig,
  })

  return {
    persistedHistory: stack.persistedHistoryCandidate,
    requestHistory: stack.requestHistory,
    requestUser: stack.preparedTrailingMessage ?? args.user,
    stack,
    strategyFacts: stack.facts,
  }
}
