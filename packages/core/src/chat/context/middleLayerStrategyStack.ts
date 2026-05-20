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
import { applyRequestSnip, resolveAdaptiveSnipPolicy, type AdaptiveSnipPolicy, type SnipImpact } from './snip'
import type { AnthropicCacheEditPlan, PromptBlock, PromptMessage } from '../../prompts'

export type MiddleLayerStage = 'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'
export type MiddleLayerStageRole = 'budget_reducer' | 'semantic_projection' | 'terminal_fallback'
export type MiddleLayerStageDisposition = 'applied' | 'skipped'
export type MiddleLayerStageScope =
  | 'persisted_history_candidate'
  | 'request_history_projection'
  | 'assembled_request_envelope'

export const MIDDLE_LAYER_STAGE_ORDER: MiddleLayerStage[] = [
  'microcompact',
  'tool_result_budget',
  'snip',
  'collapse',
  'prune',
]

type MiddleLayerStageFactBase = {
  stage: MiddleLayerStage
  role: MiddleLayerStageRole
  scope: MiddleLayerStageScope
  disposition: MiddleLayerStageDisposition
  terminal: boolean
  advisory: boolean
  reason: string
  estimatedTokensSaved: number
  inputTokens: number
  outputTokens: number
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

export type MiddleLayerSnipFact = MiddleLayerStageFactBase & {
  applied: boolean
  pressureRatio: number | null
  policy: AdaptiveSnipPolicy
  impact: SnipImpact
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
  metadata: ContextCollapseMeta | null
}

export type MiddleLayerStrategyFacts = {
  stageOrder: MiddleLayerStage[]
  toolResultBudget: MiddleLayerToolResultBudgetFact
  microCompact: MiddleLayerMicroCompactFact
  snip: MiddleLayerSnipFact
  prune: MiddleLayerPruneFact
  collapse: MiddleLayerCollapseFact
}

export type MiddleLayerStrategyStackResult = {
  microCompactedHistory: PromptMessage[]
  toolBudgetedHistory: PromptMessage[]
  snippedHistory: PromptMessage[]
  collapsedHistory: PromptMessage[]
  persistedHistoryCandidate: PromptMessage[]
  preparedMessages: PromptMessage[]
  preparedTrailingMessage: PromptMessage | null
  requestHistory: PromptMessage[]
  cacheEditPlan: AnthropicCacheEditPlan | null
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
  enableCacheEditing?: boolean
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
    timeAwareEligibleToolNames: policy.timeAwareEligibleToolNames,
    timeAwareMinResultChars: policy.timeAwareMinResultChars,
    timeAwareMinResultCharsByName: policy.timeAwareMinResultCharsByName,
    timeAwareMinStaleUserTurns: policy.timeAwareMinStaleUserTurns,
    enableCacheEditing: args.enableCacheEditing,
  })
  const inputHistoryTokens = estimatePromptTokens({ system: [], messages: args.history })
  const microCompactedHistoryTokens = estimatePromptTokens({ system: [], messages: microCompactResult.messages })
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
  const toolBudgetedHistoryTokens = estimatePromptTokens({ system: [], messages: toolResultBudgetResult.messages })
  const snipPolicy = resolveAdaptiveSnipPolicy({ pressureRatio })
  const snipResult = applyRequestSnip({
    messages: toolResultBudgetResult.messages,
    policy: snipPolicy,
  })
  const snippedHistoryTokens = estimatePromptTokens({ system: [], messages: snipResult.messages })
  const collapseResult =
    args.enableCollapse === false
      ? {
          messages: snipResult.messages,
          collapsed: false,
          collapsedHeadMessageCount: 0,
          estimatedTokensSaved: 0,
          metadata: null,
        }
      : collapseRequestHistory({
          messages: snipResult.messages,
          allowBoundarylessContinuation: args.allowBoundarylessContinuation,
        })
  const collapsedHistoryTokens = estimatePromptTokens({ system: [], messages: collapseResult.messages })
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
    snippedHistory: snipResult.messages,
    collapsedHistory: collapseResult.messages,
    persistedHistoryCandidate: args.history,
    preparedMessages,
    preparedTrailingMessage,
    requestHistory,
    cacheEditPlan: microCompactResult.cacheEditPlan,
    facts: {
      stageOrder: [...MIDDLE_LAYER_STAGE_ORDER],
      toolResultBudget: {
        stage: 'tool_result_budget',
        role: 'budget_reducer',
        scope: 'request_history_projection',
        disposition: toolResultBudgetResult.applied ? 'applied' : 'skipped',
        terminal: false,
        advisory: true,
        reason: buildToolResultBudgetReason({
          disabledByConfig: args.enableToolResultBudget === false,
          applied: toolResultBudgetResult.applied,
          policy: toolResultBudgetPolicy,
          impact: toolResultBudgetResult.impact,
        }),
        estimatedTokensSaved: Math.max(0, toolResultBudgetResult.impact.estimatedTokensSaved),
        inputTokens: microCompactedHistoryTokens,
        outputTokens: toolBudgetedHistoryTokens,
        applied: toolResultBudgetResult.applied,
        pressureRatio,
        policy: toolResultBudgetPolicy,
        impact: toolResultBudgetResult.impact,
      },
      microCompact: {
        stage: 'microcompact',
        role: 'budget_reducer',
        scope: 'request_history_projection',
        disposition: microCompactResult.compacted ? 'applied' : 'skipped',
        terminal: false,
        advisory: true,
        reason: buildMicroCompactReason({
          applied: microCompactResult.compacted,
          compactedBlocks: microCompactResult.compactedBlocks,
        }),
        estimatedTokensSaved: Math.max(0, microCompactResult.estimatedTokensSaved),
        inputTokens: inputHistoryTokens,
        outputTokens: microCompactedHistoryTokens,
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
          timeAwareEligibleToolNames: microCompactResult.timeAwareEligibleToolNames,
          timeAwareMinResultChars: microCompactResult.timeAwareMinResultChars,
          timeAwareMinStaleUserTurns: microCompactResult.timeAwareMinStaleUserTurns,
          timeAwareCompactedBlocks: microCompactResult.timeAwareCompactedBlocks,
          timeAwareToolNames: microCompactResult.timeAwareToolNames,
          cacheEditingPlannedBlocks: microCompactResult.cacheEditingPlannedBlocks,
        },
      },
      snip: {
        stage: 'snip',
        role: 'budget_reducer',
        scope: 'request_history_projection',
        disposition: snipResult.applied ? 'applied' : 'skipped',
        terminal: false,
        advisory: true,
        reason: buildSnipReason({
          enabled: snipPolicy.enabled,
          applied: snipResult.applied,
          impact: snipResult.impact,
        }),
        estimatedTokensSaved: Math.max(0, snipResult.impact.estimatedTokensSaved),
        inputTokens: toolBudgetedHistoryTokens,
        outputTokens: snippedHistoryTokens,
        applied: snipResult.applied,
        pressureRatio,
        policy: snipPolicy,
        impact: snipResult.impact,
      },
      prune: {
        stage: 'prune',
        role: 'terminal_fallback',
        scope: 'assembled_request_envelope',
        disposition:
          preparedMessages.length !== prePruneMessages.length || totalTokensAfterPrune !== totalTokensBeforePrune
            ? 'applied'
            : 'skipped',
        terminal: true,
        advisory: false,
        reason: buildPruneReason({
          budgetConfig: args.budgetConfig ?? null,
          applied:
            preparedMessages.length !== prePruneMessages.length || totalTokensAfterPrune !== totalTokensBeforePrune,
          totalTokensBeforePrune,
        }),
        estimatedTokensSaved: Math.max(0, totalTokensBeforePrune - totalTokensAfterPrune),
        inputTokens: totalTokensBeforePrune,
        outputTokens: totalTokensAfterPrune,
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
        disposition: collapseResult.collapsed ? 'applied' : 'skipped',
        terminal: false,
        advisory: true,
        reason: buildCollapseReason({
          disabledByConfig: args.enableCollapse === false,
          applied: collapseResult.collapsed,
          allowBoundarylessContinuation: args.allowBoundarylessContinuation,
        }),
        estimatedTokensSaved: Math.max(0, collapseResult.estimatedTokensSaved),
        inputTokens: snippedHistoryTokens,
        outputTokens: collapsedHistoryTokens,
        applied: collapseResult.collapsed,
        collapsedHeadMessageCount: collapseResult.collapsedHeadMessageCount,
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

function buildMicroCompactReason(args: { applied: boolean; compactedBlocks: number }): string {
  if (args.applied) return `compacted ${args.compactedBlocks} eligible older block(s)`
  return 'no eligible older blocks exceeded microcompact thresholds'
}

function buildToolResultBudgetReason(args: {
  disabledByConfig: boolean
  applied: boolean
  policy: AdaptiveToolResultBudgetPolicy
  impact: ToolResultBudgetImpact
}): string {
  if (args.disabledByConfig) return 'tool-result budget disabled by config'
  if (args.policy.maxToolResultTokens == null) return 'tool-result budget inactive for current pressure tier'
  if (args.applied) return `tool-result group exceeded budget (${args.policy.maxToolResultTokens} tokens)`
  if (args.impact.totalToolResultTokensBefore <= args.policy.maxToolResultTokens) return 'tool-result group already within budget'
  return 'tool-result group exceeded budget but no eligible replacements were available'
}

function buildCollapseReason(args: {
  disabledByConfig: boolean
  applied: boolean
  allowBoundarylessContinuation: boolean | undefined
}): string {
  if (args.disabledByConfig) return 'collapse disabled by config'
  if (args.applied) return 'collapsed older continuation into request recap'
  if (args.allowBoundarylessContinuation) return 'collapse conditions not met for current continuation view'
  return 'no latest compact boundary for request-only collapse'
}

function buildSnipReason(args: {
  enabled: boolean
  applied: boolean
  impact: SnipImpact
}): string {
  if (!args.enabled) return 'snip inactive for current pressure tier'
  if (args.applied) return `snipped ${args.impact.snippedMessages} older assistant message(s)`
  if (args.impact.keptRecentMessages > 0) return 'eligible assistant text preserved by recent-message keep rule'
  return 'no eligible older assistant text exceeded snip thresholds'
}

function buildPruneReason(args: {
  budgetConfig: ContextBudgetConfig | null
  applied: boolean
  totalTokensBeforePrune: number
}): string {
  if (!args.budgetConfig) return 'contextWindowTokens unavailable for terminal prune fallback'
  if (args.applied) return `assembled request exceeded effective limit (${args.totalTokensBeforePrune} tokens)`
  return 'assembled request already within effective limit'
}
