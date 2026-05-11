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

export type MiddleLayerStage = 'microcompact' | 'tool_result_budget' | 'collapse' | 'prune'
export type MiddleLayerStageRole = 'budget_reducer' | 'semantic_projection' | 'terminal_fallback'
export type MiddleLayerStageScope =
  | 'persisted_history_candidate'
  | 'request_history_projection'
  | 'assembled_request_envelope'

type MiddleLayerStageFactBase = {
  stage: MiddleLayerStage
  role: MiddleLayerStageRole
  scope: MiddleLayerStageScope
}

export type MiddleLayerToolResultBudgetFact = MiddleLayerStageFactBase & {
  applied: boolean
  pressureRatio: number | null
  policy: AdaptiveToolResultBudgetPolicy
  impact: ToolResultBudgetImpact
}

export type MiddleLayerMicroCompactFact = MiddleLayerStageFactBase & {
  applied: boolean
  pressureRatio: number | null
  policy: AdaptiveMicroCompactPolicy
  impact: MicroCompactImpact
}

export type MiddleLayerPruneFact = MiddleLayerStageFactBase & {
  applied: boolean
  totalTokensBeforePrune: number
  totalTokensAfterPrune: number
  messageCountBeforePrune: number
  messageCountAfterPrune: number
}

export type MiddleLayerCollapseFact = MiddleLayerStageFactBase & {
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
  collapsedHistory: PromptMessage[]
  persistedHistoryCandidate: PromptMessage[]
  preparedMessages: PromptMessage[]
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
  const toolResultBudgetPolicy = resolveAdaptiveToolResultBudgetPolicy({
    pressureRatio,
    budgetConfig: args.budgetConfig ?? null,
  })
  const toolResultBudgetResult =
    args.enableToolResultBudget === false
      ? {
          messages: microCompactResult.messages,
          applied: false,
          impact: {
            replacedBlocks: 0,
            replacedToolNames: [],
            estimatedTokensSaved: 0,
            keptRecentBlocks: 0,
            budgetTokens: toolResultBudgetPolicy.maxToolResultTokens,
            totalToolResultTokensBefore: estimateToolResultGroupTokens(microCompactResult.messages),
            totalToolResultTokensAfter: estimateToolResultGroupTokens(microCompactResult.messages),
          },
        }
      : applyToolResultBudget({
          messages: microCompactResult.messages,
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
  const prePruneMessages = trailingMessage ? [...collapseResult.messages, trailingMessage] : [...collapseResult.messages]
  const totalTokensBeforePrune = estimatePromptTokens({
    system: args.system,
    messages: prePruneMessages,
  })
  const preparedMessages = args.budgetConfig
    ? pruneForPromptBudget({
        system: args.system,
        messages: prePruneMessages,
        ...args.budgetConfig,
      }).messages
    : prePruneMessages
  const totalTokensAfterPrune = estimatePromptTokens({
    system: args.system,
    messages: preparedMessages,
  })

  const preparedTrailingMessage = trailingMessage
    ? ((preparedMessages[preparedMessages.length - 1] ?? trailingMessage) as PromptMessage)
    : null
  const requestHistory = trailingMessage ? preparedMessages.slice(0, -1) : preparedMessages

  return {
    microCompactedHistory: microCompactResult.messages,
    toolBudgetedHistory: toolResultBudgetResult.messages,
    collapsedHistory: collapseResult.messages,
    persistedHistoryCandidate: microCompactResult.messages,
    preparedMessages,
    preparedTrailingMessage,
    requestHistory,
    facts: {
      toolResultBudget: {
        stage: 'tool_result_budget',
        role: 'budget_reducer',
        scope: 'request_history_projection',
        applied: toolResultBudgetResult.applied,
        pressureRatio,
        policy: toolResultBudgetPolicy,
        impact: toolResultBudgetResult.impact,
      },
      microCompact: {
        stage: 'microcompact',
        role: 'budget_reducer',
        scope: 'persisted_history_candidate',
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
        stage: 'prune',
        role: 'terminal_fallback',
        scope: 'assembled_request_envelope',
        applied:
          preparedMessages.length !== prePruneMessages.length || totalTokensAfterPrune !== totalTokensBeforePrune,
        totalTokensBeforePrune,
        totalTokensAfterPrune,
        messageCountBeforePrune: prePruneMessages.length,
        messageCountAfterPrune: preparedMessages.length,
      },
      collapse: {
        stage: 'collapse',
        role: 'semantic_projection',
        scope: 'request_history_projection',
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
