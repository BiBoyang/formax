import { computeContextStats, type ContextBudgetConfig } from './budget'
import { collapseRequestHistory, type ContextCollapseMeta } from './contextCollapse'
import { estimatePromptTokens } from './estimate'
import {
  microCompactHistory,
  resolveAdaptiveMicroCompactPolicy,
  type AdaptiveMicroCompactPolicy,
  type MicroCompactImpact,
} from './microCompact'
import { pruneForPromptBudget } from './prune'
import {
  applyToolResultBudget,
  estimateToolResultGroupTokens,
  resolveAdaptiveToolResultBudgetPolicy,
  type AdaptiveToolResultBudgetPolicy,
  type ToolResultBudgetImpact,
} from './toolResultBudget'
import type { PromptBlock, PromptMessage } from '../../prompts'

export type MiddleLayerToolResultBudgetFact = {
  applied: boolean
  pressureRatio: number | null
  policy: AdaptiveToolResultBudgetPolicy
  impact: ToolResultBudgetImpact
}

export type MiddleLayerMicroCompactFact = {
  applied: boolean
  pressureRatio: number | null
  policy: AdaptiveMicroCompactPolicy
  impact: MicroCompactImpact
}

export type MiddleLayerPruneFact = {
  applied: boolean
  totalTokensBeforePrune: number
  totalTokensAfterPrune: number
  messageCountBeforePrune: number
  messageCountAfterPrune: number
}

export type MiddleLayerCollapseFact = {
  applied: boolean
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  metadata: ContextCollapseMeta | null
}

export type MiddleLayerStrategyFacts = {
  toolResultBudget: MiddleLayerToolResultBudgetFact
  microCompact: MiddleLayerMicroCompactFact
  prune: MiddleLayerPruneFact
  collapse: MiddleLayerCollapseFact
}

export type MiddleLayerStrategyStackResult = {
  microCompactedHistory: PromptMessage[]
  toolBudgetedHistory: PromptMessage[]
  preparedMessages: PromptMessage[]
  preparedHistory: PromptMessage[]
  preparedTrailingMessage: PromptMessage | null
  requestHistory: PromptMessage[]
  facts: MiddleLayerStrategyFacts
}

export function executeMiddleLayerStrategyStack(args: {
  system: PromptBlock[]
  history: PromptMessage[]
  trailingMessage?: PromptMessage | null
  budgetConfig?: ContextBudgetConfig | null
  allowBoundarylessContinuation?: boolean
  enableToolResultBudget?: boolean
  enableCollapse?: boolean
}): MiddleLayerStrategyStackResult {
  const trailingMessage = args.trailingMessage ?? null
  const preMicrocompactMessages = trailingMessage ? [...args.history, trailingMessage] : [...args.history]
  const pressureRatio = resolvePressureRatio({
    system: args.system,
    messages: preMicrocompactMessages,
    budgetConfig: args.budgetConfig ?? null,
  })
  const policy = resolveAdaptiveMicroCompactPolicy({ pressureRatio })
  const microCompactResult = microCompactHistory({
    messages: args.history,
    eligibleToolNames: policy.eligibleToolNames,
    keepRecentToolResults: policy.keepRecentToolResults,
    keepRecentToolResultsByName: policy.keepRecentToolResultsByName,
    minResultChars: policy.minResultChars,
    minResultCharsByName: policy.minResultCharsByName,
    cacheAwareEligibleToolNames: policy.cacheAwareEligibleToolNames,
    cacheAwareMinResultChars: policy.cacheAwareMinResultChars,
  })

  const rawPreparedMessages = trailingMessage
    ? [...microCompactResult.messages, trailingMessage]
    : [...microCompactResult.messages]
  const totalTokensBeforePrune = estimatePromptTokens({
    system: args.system,
    messages: rawPreparedMessages,
  })
  const preparedMessages = args.budgetConfig
    ? pruneForPromptBudget({
        system: args.system,
        messages: rawPreparedMessages,
        ...args.budgetConfig,
      }).messages
    : rawPreparedMessages
  const totalTokensAfterPrune = estimatePromptTokens({
    system: args.system,
    messages: preparedMessages,
  })

  const preparedTrailingMessage = trailingMessage
    ? ((preparedMessages[preparedMessages.length - 1] ?? trailingMessage) as PromptMessage)
    : null
  const preparedHistory = trailingMessage ? preparedMessages.slice(0, -1) : preparedMessages
  const toolResultBudgetPolicy = resolveAdaptiveToolResultBudgetPolicy({
    pressureRatio,
    budgetConfig: args.budgetConfig ?? null,
  })
  const toolResultBudgetResult =
    args.enableToolResultBudget === false
      ? {
          messages: preparedHistory,
          applied: false,
          impact: {
            replacedBlocks: 0,
            replacedToolNames: [],
            estimatedTokensSaved: 0,
            keptRecentBlocks: 0,
            budgetTokens: toolResultBudgetPolicy.maxToolResultTokens,
            totalToolResultTokensBefore: estimateToolResultGroupTokens(preparedHistory),
            totalToolResultTokensAfter: estimateToolResultGroupTokens(preparedHistory),
          },
        }
      : applyToolResultBudget({
          messages: preparedHistory,
          policy: toolResultBudgetPolicy,
        })
  const collapseResult =
    args.enableCollapse === false
      ? {
          messages: toolResultBudgetResult.messages,
          collapsed: false,
          collapsedHeadMessageCount: 0,
          estimatedTokensSaved: 0,
          metadata: null,
        }
      : collapseRequestHistory({
          messages: toolResultBudgetResult.messages,
          allowBoundarylessContinuation: args.allowBoundarylessContinuation,
        })

  return {
    microCompactedHistory: microCompactResult.messages,
    toolBudgetedHistory: toolResultBudgetResult.messages,
    preparedMessages,
    preparedHistory,
    preparedTrailingMessage,
    requestHistory: collapseResult.messages,
    facts: {
      toolResultBudget: {
        applied: toolResultBudgetResult.applied,
        pressureRatio,
        policy: toolResultBudgetPolicy,
        impact: toolResultBudgetResult.impact,
      },
      microCompact: {
        applied: microCompactResult.compacted,
        pressureRatio,
        policy,
        impact: {
          compactedBlocks: microCompactResult.compactedBlocks,
          compactedToolNames: microCompactResult.compactedToolNames,
          estimatedTokensSaved: microCompactResult.estimatedTokensSaved,
          keptRecentBlocks: microCompactResult.keptRecentBlocks,
          cacheAwareEligibleToolNames: microCompactResult.cacheAwareEligibleToolNames,
          cacheAwareMinResultChars: microCompactResult.cacheAwareMinResultChars,
          cacheAwareCompactedBlocks: microCompactResult.cacheAwareCompactedBlocks,
          cacheAwareToolNames: microCompactResult.cacheAwareToolNames,
        },
      },
      prune: {
        applied:
          preparedMessages.length !== rawPreparedMessages.length || totalTokensAfterPrune !== totalTokensBeforePrune,
        totalTokensBeforePrune,
        totalTokensAfterPrune,
        messageCountBeforePrune: rawPreparedMessages.length,
        messageCountAfterPrune: preparedMessages.length,
      },
      collapse: {
        applied: collapseResult.collapsed,
        collapsedHeadMessageCount: collapseResult.collapsedHeadMessageCount,
        estimatedTokensSaved: collapseResult.estimatedTokensSaved,
        metadata: collapseResult.metadata,
      },
    },
  }
}

function resolvePressureRatio(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  budgetConfig: ContextBudgetConfig | null
}): number | null {
  if (!args.budgetConfig) return null
  const stats = computeContextStats({
    config: args.budgetConfig,
    usedTokens: estimatePromptTokens({
      system: args.system,
      messages: args.messages,
    }),
  })
  if (!Number.isFinite(stats.effectiveLimitTokens) || stats.effectiveLimitTokens <= 0) return null
  return stats.usedTokens / stats.effectiveLimitTokens
}
