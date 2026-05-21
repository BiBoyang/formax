import type { ContextBudgetConfig } from './budget'
import {
  buildContextProjection,
  type ContextProjection,
  type ContextProjectionDurableInputState,
} from './contextProjection'
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
  contextProjection: ContextProjection
  stack: MiddleLayerStrategyStackResult
  strategyFacts: MiddleLayerStrategyFacts
}

export function prepareTurnRequestProjection(args: {
  system: PromptBlock[]
  history: PromptMessage[]
  user: PromptMessage
  budgetConfig: ContextBudgetConfig | null
  durableState?: ContextProjectionDurableInputState
  enableCacheEditing?: boolean
  enableTimeBasedMicroCompact?: boolean
}): PreparedTurnRequestProjection {
  const contextProjection = buildContextProjection({
    history: args.history,
    ...(args.durableState !== undefined ? { durableState: args.durableState } : {}),
  })
  const stack = executeMiddleLayerStrategyStack({
    system: args.system,
    history: contextProjection.modelFacingBaseline,
    trailingMessage: args.user,
    budgetConfig: args.budgetConfig,
    ...(contextProjection.facts.activeCompactBoundaryFingerprint ? { allowBoundarylessContinuation: true } : {}),
    ...(args.enableCacheEditing !== undefined ? { enableCacheEditing: args.enableCacheEditing } : {}),
    ...(args.enableTimeBasedMicroCompact !== undefined
      ? { enableTimeBasedMicroCompact: args.enableTimeBasedMicroCompact }
      : {}),
  })

  return {
    persistedHistory: args.history,
    requestHistory: stack.requestHistory,
    requestUser: stack.preparedTrailingMessage ?? args.user,
    cacheEditPlan: stack.cacheEditPlan ?? null,
    contextProjection,
    stack,
    strategyFacts: stack.facts,
  }
}
