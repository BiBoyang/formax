import type { ContextBudgetConfig } from './budget'
import { computeContextBudget, computeContextStats } from './budget'
import { estimatePromptTokens } from './estimate'
import { getKnownContextWindowTokens } from './modelWindow'
import { MICROCOMPACT_STUB_PREFIX } from './microCompact'
import { microCompactHistory, resolveAdaptiveMicroCompactPolicy, type MicroCompactImpact } from './microCompact'
import { collapseRequestHistory, CONTEXT_COLLAPSE_PREFIX, type ContextCollapseMeta } from './contextCollapse'
import { pruneForPromptBudget } from './prune'
import {
  AUTO_COMPACT_WORKING_SET_MAX_BACKTRACK_TURNS,
  buildWorkingSetAwareAutoCompactKeepStrategy,
  buildDefaultCompactRehydrationPlan,
  countNonToolUserTurns,
  deriveAutoCompactWorkingSetSignals,
  estimateCompactRehydrationCost,
  findLatestWorkingSetAnchor,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
  findLatestCompactBoundary,
  getContinuationMessagesAfterLatestCompactBoundary,
  resolveHistoryForCompaction,
  type AutoCompactWorkingSetSignals,
  type CompactBoundaryMeta,
} from './compact'
import type { RuntimeConfig } from '../../config/config'
import type { RuntimeFlags } from '../../config/runtimeFlags'
import type { PromptBlock, PromptMessage } from '../../prompts'
import { buildSystemPrompt } from '../../prompts'
import { resolveSystemPromptVariant } from '../../prompts/system'
import { buildPostCompactRehydration } from './postCompactRehydration'
import { buildSessionMemoryCompactionRehydration, buildSessionMemoryCompactionSummary, buildSessionMemoryDraft } from './sessionMemory'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'
import type { ReactiveCompactErrorKind } from '../../features/repl/controller/send/reactiveCompact'

export type ContextDiagnostics = {
  totalTokens: number
  systemTokens: number
  systemSectionBreakdown: ContextContributor[]
  historyTokens: number
  toolResultTokens: number
  otherHistoryTokens: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  toolResultBlockCount: number
  microCompactedToolResultCount: number
  toolResultCountsByToolName: Array<{ toolName: string; count: number }>
  microCompactedCountsByToolName: Array<{ toolName: string; count: number }>
  contextWindowTokens: number | null
  effectiveLimitTokens: number | null
  autoCompactLimitTokens: number | null
  baselineTokens: number | null
  percentRemaining: number | null
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
  topSnapshotContributors: ContextContributor[]
}

export type NextTurnFixedContextGroup = {
  label: string
  blocks: PromptBlock[]
}

export type NextTurnFixedContextDiagnostics = {
  fixedGroups: Array<{ label: string; blockCount: number; tokens: number }>
  assembledLedger: ContextAssembledLedgerRow[]
  microCompactImpact: MicroCompactImpact
  collapseImpact: ContextCollapseImpact
  workingSetSignals: AutoCompactWorkingSetSignals
  lifecycleMarkers: ContextLifecycleMarker[]
  projectedHistoryTokens: number
  projectedHistoryDeltaTokens: number
  fixedTokens: number
  totalTokens: number
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
  autoCompactSkipReason: string | null
  pruneSkipReason: string | null
  topAssembledContributors: ContextContributor[]
}

export type ContextLatestRequestCollapse = {
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  recapFingerprint?: string
}

export type ContextLatestReactiveCompact = {
  triggerKind: ReactiveCompactErrorKind
  triggerDetail?: string
  strategy: 'session_memory' | 'model_summary'
}

export type ContextCollapseImpact = {
  collapsed: boolean
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  projectedHistoryTokensAfterCollapse: number
  projectedHistoryDeltaTokens: number
  metadata: ContextCollapseMeta | null
}

export type ContextContributor = {
  kind: 'system_section' | 'message' | 'tool_result' | 'fixed_group' | 'collapse_recap'
  key: string
  label: string
  tokens: number
  role?: PromptMessage['role']
  ordinal?: number
  toolUseId?: string
  toolName?: string
  systemSectionKey?: string
}

export type ContextAssembledLedgerRow = {
  kind: 'system_total' | 'request_history' | 'fixed_group' | 'fixed_total' | 'assembled_total'
  key: string
  label: string
  tokens: number
  messageCount?: number
  blockCount?: number
}

type FixedGroupSummary = {
  label: string
  blockCount: number
  tokens: number
}

export type ContextLifecycleMarker = {
  stage: 'snapshot' | 'post_microcompact' | 'post_prune' | 'post_compact'
  label: string
  totalTokens: number
  historyTokens: number
  fixedTokens: number
  deltaFromSnapshot: number
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
}

export type ContextDiagnosticsPayload = {
  kind: 'formax.context_diagnostics'
  schemaVersion: 1
  mode: string
  model: string
  latestCompactBoundary: CompactBoundaryMeta | null
  latestRequestCollapse?: ContextLatestRequestCollapse | null
  latestReactiveCompact?: ContextLatestReactiveCompact | null
  snapshot: ContextDiagnostics
  nextTurnFixed: NextTurnFixedContextDiagnostics
  notes: string[]
}

function normalizeLatestRequestCollapse(
  value: ContextLatestRequestCollapse | null | undefined,
): ContextLatestRequestCollapse | null {
  if (!value) return null
  return {
    phase: value.phase,
    collapsedHeadMessageCount: value.collapsedHeadMessageCount,
    estimatedTokensSaved: value.estimatedTokensSaved,
    ...(value.recapFingerprint ? { recapFingerprint: value.recapFingerprint } : {}),
  }
}

function normalizeLatestReactiveCompact(
  value: ContextLatestReactiveCompact | null | undefined,
): ContextLatestReactiveCompact | null {
  if (!value) return null
  return {
    triggerKind: value.triggerKind,
    strategy: value.strategy,
    ...(value.triggerDetail ? { triggerDetail: value.triggerDetail } : {}),
  }
}

export type ContextDiagnosticsOutputFormat = 'text' | 'json'

const DEFAULT_CONTEXT_DIAGNOSTICS_NOTES = [
  'Tool-result and other-history slices are approximate because token estimation is JSON-size based.',
  'When compact boundaries exist, snapshot/history analysis uses the latest compact-boundary continuation view instead of the full persisted history.',
  'Next-turn fixed context is a non-destructive projection: it includes current microcompact/prune/collapse rules and auto-injected blocks, but does not execute full auto-compact or invent future user text.',
  'Auto-compact skip reason omits the turn-gap precondition (sendSeq vs lastAutoCompactSeq) — that runtime state is unavailable to diagnostics.',
] as const

const TOP_CONTRIBUTOR_LIMIT = 5

export function resolveContextDiagnosticsOutputFormat(argsText: string): ContextDiagnosticsOutputFormat | null {
  const normalized = String(argsText || '').trim()
  if (!normalized) return 'text'
  return normalized === '--json' ? 'json' : null
}

export function analyzeContextDiagnostics(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  budgetConfig?: ContextBudgetConfig | null
}): ContextDiagnostics {
  const promptMessages = getContinuationMessagesAfterLatestCompactBoundary(args.messages)
  const toolUsesById = collectToolUsesById(promptMessages)
  const systemSectionBreakdown = buildSystemSectionContributors(args.system)
  const systemTokens = estimatePromptTokens({ system: args.system, messages: [] })
  const historyTokens = estimatePromptTokens({ system: [], messages: promptMessages })
  const totalTokens = estimatePromptTokens({ system: args.system, messages: promptMessages })
  const split = splitHistorySlices(promptMessages, toolUsesById)
  const toolResultTokens = estimatePromptTokens({ system: [], messages: split.toolResultMessages })
  const otherHistoryTokens = estimatePromptTokens({ system: [], messages: split.nonToolMessages })

  const budget = args.budgetConfig ? computeContextBudget(args.budgetConfig) : null
  const stats = args.budgetConfig
    ? computeContextStats({
        config: args.budgetConfig,
        usedTokens: totalTokens,
      })
    : null

  return {
    totalTokens,
    systemTokens,
    systemSectionBreakdown,
    historyTokens,
    toolResultTokens,
    otherHistoryTokens,
    messageCount: promptMessages.length,
    userMessageCount: promptMessages.filter((message) => message?.role === 'user').length,
    assistantMessageCount: promptMessages.filter((message) => message?.role === 'assistant').length,
    toolResultBlockCount: split.toolResultBlockCount,
    microCompactedToolResultCount: split.microCompactedToolResultCount,
    toolResultCountsByToolName: split.toolResultCountsByToolName,
    microCompactedCountsByToolName: split.microCompactedCountsByToolName,
    contextWindowTokens: budget?.contextWindowTokens ?? null,
    effectiveLimitTokens: budget?.effectiveLimitTokens ?? null,
    autoCompactLimitTokens: budget?.autoCompactLimitTokens ?? null,
    baselineTokens: args.budgetConfig?.baselineTokens ?? null,
    percentRemaining: stats?.percentRemaining ?? null,
    remainingToEffectiveLimit: budget ? Math.max(0, budget.effectiveLimitTokens - totalTokens) : null,
    remainingToAutoCompactLimit: budget ? Math.max(0, budget.autoCompactLimitTokens - totalTokens) : null,
    shouldAutoCompact: stats?.shouldAutoCompact ?? null,
    topSnapshotContributors: buildTopSnapshotContributors({
      systemSectionBreakdown,
      messages: promptMessages,
      toolUsesById,
    }),
  }
}

function deriveAutoCompactSkipReason(args: {
  enableAutoCompact: boolean | undefined
  budgetConfig: ContextBudgetConfig | null
  microCompactedHistory: PromptMessage[]
  totalTokensBeforePrune: number
}): string | null {
  if (!args.enableAutoCompact) return 'auto-compact disabled (enableAutoCompact=false)'
  if (!args.budgetConfig) return 'contextWindowTokens unknown'
  if (args.microCompactedHistory.length === 0) return 'history is empty'
  const nonToolTurns = countNonToolUserTurns(args.microCompactedHistory)
  if (nonToolTurns < 2) return `fewer than 2 non-tool user turns (got ${nonToolTurns})`
  // Note: turn-gap precondition (sendSeq vs lastAutoCompactSeq) is runtime state — not available here
  const stats = computeContextStats({ config: args.budgetConfig, usedTokens: args.totalTokensBeforePrune })
  if (!stats.shouldAutoCompact) {
    return `below threshold (used=${stats.usedTokens} limit=${stats.autoCompactLimitTokens})`
  }
  return null
}

function derivePruneSkipReason(args: {
  budgetConfig: ContextBudgetConfig | null
  totalTokensBeforePrune: number
  totalTokensAfterPrune: number
}): string | null {
  if (!args.budgetConfig) return 'contextWindowTokens unknown — cannot evaluate prune threshold'
  const budget = computeContextBudget(args.budgetConfig)
  if (args.totalTokensBeforePrune <= budget.effectiveLimitTokens) {
    return `within effective limit (used=${args.totalTokensBeforePrune} limit=${budget.effectiveLimitTokens})`
  }
  if (args.totalTokensAfterPrune < args.totalTokensBeforePrune) return null
  return `pre-prune prompt exceeded effective limit but prune made no reduction (used=${args.totalTokensBeforePrune} limit=${budget.effectiveLimitTokens})`
}

export function analyzeNextTurnFixedContext(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  fixedGroups: NextTurnFixedContextGroup[]
  budgetConfig?: ContextBudgetConfig | null
  cwd: string
  mode: string
  planPath?: string | null
  keepLastTurns?: number
  enableAutoCompact?: boolean
}): NextTurnFixedContextDiagnostics {
  const promptMessages = getContinuationMessagesAfterLatestCompactBoundary(args.messages)
  const hasLatestCompactBoundary = findLatestCompactBoundary(args.messages) != null
  const fixedGroups = args.fixedGroups
    .map((group) => ({
      label: group.label,
      blocks: Array.isArray(group.blocks) ? group.blocks : [],
    }))
    .filter((group) => group.blocks.length > 0)

  const preMicrocompactFixedMessage =
    fixedGroups.length > 0
      ? ({
          role: 'user' as const,
          content: fixedGroups.flatMap((group) => group.blocks),
        } satisfies PromptMessage)
      : null
  const preMicrocompactMessages = preMicrocompactFixedMessage
    ? [...promptMessages, preMicrocompactFixedMessage]
    : [...promptMessages]
  const microCompactPressureRatio = args.budgetConfig
    ? (() => {
        const stats = computeContextStats({
          config: args.budgetConfig,
          usedTokens: estimatePromptTokens({
            system: args.system,
            messages: preMicrocompactMessages,
          }),
        })
        if (!Number.isFinite(stats.effectiveLimitTokens) || stats.effectiveLimitTokens <= 0) return null
        return stats.usedTokens / stats.effectiveLimitTokens
      })()
    : null
  const microCompactPolicy = resolveAdaptiveMicroCompactPolicy({
    pressureRatio: microCompactPressureRatio,
  })

  const microCompactResult = microCompactHistory({
    messages: promptMessages,
    eligibleToolNames: microCompactPolicy.eligibleToolNames,
    keepRecentToolResults: microCompactPolicy.keepRecentToolResults,
    keepRecentToolResultsByName: microCompactPolicy.keepRecentToolResultsByName,
    minResultChars: microCompactPolicy.minResultChars,
    minResultCharsByName: microCompactPolicy.minResultCharsByName,
  })
  const microCompactedHistory = microCompactResult.messages
  const fixedUserMessage = preMicrocompactFixedMessage

  const rawPreparedMessages = fixedUserMessage ? [...microCompactedHistory, fixedUserMessage] : [...microCompactedHistory]
  const fallbackRehydration = buildPostCompactRehydration({
    cwd: args.cwd,
    mode: normalizeDiagnosticsMode(args.mode),
    planPath: args.planPath ?? null,
    previousHistory: promptMessages,
  })
  const baseWorkingSetSignals = deriveAutoCompactWorkingSetSignals({
    mode: normalizeDiagnosticsMode(args.mode),
    rehydration: fallbackRehydration,
  })
  const workingSetAnchor = (() => {
    const userTurnIndices = promptMessages.reduce<number[]>((out, message, index) => {
      if (message?.role !== 'user' || !Array.isArray(message.content)) return out
      if ((message.content as any[]).some((block) => block?.type === 'tool_result')) return out
      out.push(index)
      return out
    }, [])
    const anchor = findLatestWorkingSetAnchor(promptMessages, userTurnIndices)
    if (!anchor) return null
    const keepLastTurns = Math.max(0, Math.floor(args.keepLastTurns ?? 4))
    const keepMinUserTurns = Math.max(1, 1 + baseWorkingSetSignals.keepMinUserTurnsBoost)
    const baselineStartTurnPosition = Math.max(0, userTurnIndices.length - Math.max(keepLastTurns, keepMinUserTurns))
    const anchorBacktrackTurns =
      anchor.turnPosition < baselineStartTurnPosition &&
      baselineStartTurnPosition - anchor.turnPosition <= AUTO_COMPACT_WORKING_SET_MAX_BACKTRACK_TURNS
        ? baselineStartTurnPosition - anchor.turnPosition
        : 0
    return {
      kind: anchor.kind,
      toolNames: anchor.toolNames,
      backtrackTurns: anchorBacktrackTurns,
    }
  })()
  const workingSetSignals = deriveAutoCompactWorkingSetSignals({
    mode: normalizeDiagnosticsMode(args.mode),
    rehydration: fallbackRehydration,
    workingSetAnchor,
  })
  const totalTokensBeforePrune = estimatePromptTokens({ system: args.system, messages: rawPreparedMessages })
  const preparedMessages = args.budgetConfig
    ? pruneForPromptBudget({
        system: args.system,
        messages: rawPreparedMessages,
        ...args.budgetConfig,
      }).messages
    : rawPreparedMessages

  const projectedHistory = fixedUserMessage ? preparedMessages.slice(0, -1) : preparedMessages
  const preparedFixedMessage = fixedUserMessage ? (preparedMessages[preparedMessages.length - 1] ?? fixedUserMessage) : null
  const collapseResult = collapseRequestHistory({
    messages: projectedHistory,
    allowBoundarylessContinuation: hasLatestCompactBoundary,
  })
  const collapsedProjectedHistory = collapseResult.messages
  const assembledMessagesBeforeCollapse = preparedFixedMessage ? [...projectedHistory, preparedFixedMessage] : projectedHistory
  const assembledMessages = preparedFixedMessage ? [...collapsedProjectedHistory, preparedFixedMessage] : collapsedProjectedHistory
  const projectedToolUsesById = collectToolUsesById(collapsedProjectedHistory)
  const lifecycleMarkers = buildLifecycleMarkers({
    system: args.system,
    snapshotHistory: promptMessages,
    microCompactedHistory,
    postPruneMessages: preparedMessages,
    preparedFixedMessage,
    budgetConfig: args.budgetConfig ?? null,
    cwd: args.cwd,
    mode: normalizeDiagnosticsMode(args.mode),
    planPath: args.planPath ?? null,
    keepLastTurns: args.keepLastTurns ?? 4,
  })

  const totalTokens = estimatePromptTokens({ system: args.system, messages: assembledMessages })
  const projectedHistoryTokens = estimatePromptTokens({ system: [], messages: projectedHistory })
  const projectedHistoryTokensAfterCollapse = estimatePromptTokens({ system: [], messages: collapsedProjectedHistory })
  const snapshotHistoryTokens = estimatePromptTokens({ system: [], messages: promptMessages })
  const fixedTokens = preparedFixedMessage ? estimatePromptTokens({ system: [], messages: [preparedFixedMessage] }) : 0
  const systemTokens = estimatePromptTokens({ system: args.system, messages: [] })
  const stats = args.budgetConfig
    ? computeContextStats({
        config: args.budgetConfig,
        usedTokens: totalTokens,
      })
    : null
  const budget = args.budgetConfig ? computeContextBudget(args.budgetConfig) : null

  const fixedGroupSummaries = fixedGroups.map((group) => ({
    label: group.label,
    blockCount: group.blocks.length,
    tokens: estimatePromptTokens({
      system: [],
      messages: [{ role: 'user', content: group.blocks }],
    }),
  }))

  return {
    fixedGroups: fixedGroupSummaries,
    assembledLedger: buildAssembledLedger({
      system: args.system,
      systemTokens,
      collapsedProjectedHistory,
      projectedHistoryTokensAfterCollapse,
      fixedGroups: fixedGroupSummaries,
      fixedTokens,
      totalTokens,
    }),
    microCompactImpact: {
      compactedBlocks: microCompactResult.compactedBlocks,
      compactedToolNames: microCompactResult.compactedToolNames,
      estimatedTokensSaved: microCompactResult.estimatedTokensSaved,
      keptRecentBlocks: microCompactResult.keptRecentBlocks,
    },
    collapseImpact: {
      collapsed: collapseResult.collapsed,
      collapsedHeadMessageCount: collapseResult.collapsedHeadMessageCount,
      estimatedTokensSaved: collapseResult.estimatedTokensSaved,
      projectedHistoryTokensAfterCollapse,
      projectedHistoryDeltaTokens: projectedHistoryTokensAfterCollapse - projectedHistoryTokens,
      metadata: collapseResult.metadata,
    },
    workingSetSignals,
    lifecycleMarkers,
    projectedHistoryTokens,
    projectedHistoryDeltaTokens: projectedHistoryTokens - snapshotHistoryTokens,
    fixedTokens,
    totalTokens,
    remainingToEffectiveLimit: budget ? Math.max(0, budget.effectiveLimitTokens - totalTokens) : null,
    remainingToAutoCompactLimit: budget ? Math.max(0, budget.autoCompactLimitTokens - totalTokens) : null,
    shouldAutoCompact: stats?.shouldAutoCompact ?? null,
    autoCompactSkipReason: deriveAutoCompactSkipReason({
      enableAutoCompact: args.enableAutoCompact,
      budgetConfig: args.budgetConfig ?? null,
      microCompactedHistory,
      totalTokensBeforePrune,
    }),
    pruneSkipReason: derivePruneSkipReason({
      budgetConfig: args.budgetConfig ?? null,
      totalTokensBeforePrune,
      totalTokensAfterPrune: estimatePromptTokens({ system: args.system, messages: assembledMessagesBeforeCollapse }),
    }),
    topAssembledContributors: buildTopAssembledContributors({
      system: args.system,
      projectedHistory: collapsedProjectedHistory,
      projectedToolUsesById,
      fixedGroups,
    }),
  }
}

function buildAssembledLedger(args: {
  system: PromptBlock[]
  systemTokens: number
  collapsedProjectedHistory: PromptMessage[]
  projectedHistoryTokensAfterCollapse: number
  fixedGroups: FixedGroupSummary[]
  fixedTokens: number
  totalTokens: number
}): ContextAssembledLedgerRow[] {
  const fixedGroupRows = args.fixedGroups.map(
    (group, index): ContextAssembledLedgerRow => ({
      kind: 'fixed_group',
      key: `fixed_group:${index + 1}`,
      label: group.label,
      tokens: group.tokens,
      blockCount: group.blockCount,
    }),
  )

  return [
    {
      kind: 'system_total',
      key: 'system_total',
      label: 'System prompt total',
      tokens: args.systemTokens,
      blockCount: args.system.length,
    },
    {
      kind: 'request_history',
      key: 'request_history',
      label: 'Request history after microcompact/prune/collapse',
      tokens: args.projectedHistoryTokensAfterCollapse,
      messageCount: args.collapsedProjectedHistory.length,
    },
    ...fixedGroupRows,
    {
      kind: 'fixed_total',
      key: 'fixed_total',
      label: 'Fixed additions total',
      tokens: args.fixedTokens,
      blockCount: args.fixedGroups.reduce((sum, group) => sum + group.blockCount, 0),
    },
    {
      kind: 'assembled_total',
      key: 'assembled_total',
      label: 'Assembled total before future user text',
      tokens: args.totalTokens,
    },
  ]
}

export function buildContextDiagnosticsReport(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  planPath?: string | null
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
  latestRequestCollapse?: ContextLatestRequestCollapse | null
  latestReactiveCompact?: ContextLatestReactiveCompact | null
}): string {
  const payload = buildContextDiagnosticsPayload(args)
  return formatContextDiagnosticsReport({
    latestCompactBoundary: payload.latestCompactBoundary,
    latestRequestCollapse: payload.latestRequestCollapse,
    latestReactiveCompact: payload.latestReactiveCompact,
    diagnostics: payload.snapshot,
    nextTurn: payload.nextTurnFixed,
    mode: payload.mode,
    model: payload.model,
    notes: payload.notes,
  })
}

export function buildContextDiagnosticsJson(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  planPath?: string | null
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
  latestRequestCollapse?: ContextLatestRequestCollapse | null
  latestReactiveCompact?: ContextLatestReactiveCompact | null
}): string {
  return JSON.stringify(buildContextDiagnosticsPayload(args), null, 2)
}

export function buildContextDiagnosticsPayload(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  planPath?: string | null
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
  latestRequestCollapse?: ContextLatestRequestCollapse | null
  latestReactiveCompact?: ContextLatestReactiveCompact | null
}): ContextDiagnosticsPayload {
  const system = buildSystemPrompt({
    allowedSubagents: args.allowedSubagents,
    cwd: args.cwd,
    model: args.cfg.llm.model,
    variant: resolveSystemPromptVariant({
      deferredToolExposureEnabled: args.runtimeFlags?.deferredToolExposureEnabled,
    }),
  })

  const contextWindowTokens =
    args.cfg.llm.contextWindowTokens ??
    getKnownContextWindowTokens({
      provider: args.cfg.llm.provider,
      model: args.cfg.llm.model,
    })

  const diagnostics = analyzeContextDiagnostics({
    system,
    messages: args.messages,
    budgetConfig: contextWindowTokens
      ? {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        }
      : null,
  })

  const nextTurn = analyzeNextTurnFixedContext({
    system,
    messages: args.messages,
    fixedGroups: args.nextTurnFixedGroups ?? [],
    cwd: args.cwd,
    mode: args.mode,
    planPath: args.planPath ?? null,
    keepLastTurns: args.cfg.context.compactKeepLastTurns,
    enableAutoCompact: args.cfg.context.enableAutoCompact,
    budgetConfig: contextWindowTokens
      ? {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        }
      : null,
  })

  return {
    kind: 'formax.context_diagnostics',
    schemaVersion: 1,
    mode: args.mode,
    model: args.cfg.llm.model,
    latestCompactBoundary: findLatestCompactBoundary(args.messages),
    latestRequestCollapse: normalizeLatestRequestCollapse(args.latestRequestCollapse),
    latestReactiveCompact: normalizeLatestReactiveCompact(args.latestReactiveCompact),
    snapshot: diagnostics,
    nextTurnFixed: nextTurn,
    notes: [...DEFAULT_CONTEXT_DIAGNOSTICS_NOTES],
  }
}

export function formatContextDiagnosticsReport(args: {
  latestCompactBoundary?: CompactBoundaryMeta | null
  latestRequestCollapse?: ContextLatestRequestCollapse | null
  latestReactiveCompact?: ContextLatestReactiveCompact | null
  diagnostics: ContextDiagnostics
  nextTurn?: NextTurnFixedContextDiagnostics | null
  mode: string
  model: string
  notes?: string[]
}): string {
  const { diagnostics } = args
  const lines = [
    'Context diagnostics',
    '- Snapshot: latest compact-boundary continuation view only (excludes /context and next-turn injected blocks)',
    `- Mode: ${args.mode}`,
    `- Model: ${args.model || 'unknown'}`,
    '',
    'Latest compact boundary',
    `- Trigger: ${args.latestCompactBoundary?.trigger ?? 'none'}`,
    `- Trigger reason kind: ${args.latestCompactBoundary?.triggerReason?.kind ?? 'none'}`,
    `- Trigger reason detail: ${args.latestCompactBoundary?.triggerReason?.detail ?? 'none'}`,
    `- Pre-compact tokens: ${formatMaybeInt(args.latestCompactBoundary?.preTokens ?? null)}`,
    `- Summary kind: ${args.latestCompactBoundary?.summaryKind ?? 'none'}`,
    `- Keep strategy: ${formatKeepStrategy(args.latestCompactBoundary?.keepStrategy ?? null)}`,
    `- Rehydration plan: ${formatRehydrationPlan(args.latestCompactBoundary?.rehydrationPlan ?? null)}`,
    `- Rehydration cost: ${formatRehydrationCost(args.latestCompactBoundary?.rehydrationCost ?? null)}`,
    `- Preserved segment: ${formatPreservedSegment(args.latestCompactBoundary?.preservedSegment ?? null)}`,
    '',
    'Latest request collapse',
    `- Phase: ${args.latestRequestCollapse?.phase ?? 'none'}`,
    `- Collapsed older messages: ${formatMaybeInt(args.latestRequestCollapse?.collapsedHeadMessageCount ?? null)}`,
    `- Estimated tokens saved: ${formatMaybeInt(args.latestRequestCollapse?.estimatedTokensSaved ?? null)}`,
    `- Recap fingerprint: ${args.latestRequestCollapse?.recapFingerprint ?? 'none'}`,
    '',
    'Latest reactive compact',
    `- Trigger kind: ${args.latestReactiveCompact?.triggerKind ?? 'none'}`,
    `- Trigger detail: ${args.latestReactiveCompact?.triggerDetail ?? 'none'}`,
    `- Fallback strategy: ${args.latestReactiveCompact?.strategy ?? 'none'}`,
    '',
    'Budget',
    `- Context window: ${formatMaybeInt(diagnostics.contextWindowTokens)}`,
    `- Effective limit: ${formatMaybeInt(diagnostics.effectiveLimitTokens)}`,
    `- Auto-compact limit: ${formatMaybeInt(diagnostics.autoCompactLimitTokens)}`,
    `- Baseline reserve: ${formatMaybeInt(diagnostics.baselineTokens)}`,
    '',
    'Estimated usage',
    `- Total snapshot: ${formatInt(diagnostics.totalTokens)}`,
    `- System prompt: ${formatInt(diagnostics.systemTokens)}`,
    `- History total: ${formatInt(diagnostics.historyTokens)}`,
    `- Tool results (approx slice): ${formatInt(diagnostics.toolResultTokens)}`,
    `- Other history (approx slice): ${formatInt(diagnostics.otherHistoryTokens)}`,
    '',
    'System prompt breakdown',
    ...formatContributors(diagnostics.systemSectionBreakdown),
    '',
    'Pressure',
    `- Remaining to effective limit: ${formatMaybeInt(diagnostics.remainingToEffectiveLimit)}`,
    `- Remaining to auto-compact limit: ${formatMaybeInt(diagnostics.remainingToAutoCompactLimit)}`,
    `- Auto-compact would trigger now: ${formatMaybeBool(diagnostics.shouldAutoCompact)}`,
    `- Free percent to effective limit: ${formatMaybePercent(diagnostics.percentRemaining)}`,
    '',
    'History facts',
    `- Messages: ${formatInt(diagnostics.messageCount)}`,
    `- User messages: ${formatInt(diagnostics.userMessageCount)}`,
    `- Assistant messages: ${formatInt(diagnostics.assistantMessageCount)}`,
    `- Tool result blocks: ${formatInt(diagnostics.toolResultBlockCount)}`,
    `- Microcompacted tool results: ${formatInt(diagnostics.microCompactedToolResultCount)}`,
    `- Tool-result tool mix: ${formatCountsByToolName(diagnostics.toolResultCountsByToolName)}`,
    `- Microcompacted tool mix: ${formatCountsByToolName(diagnostics.microCompactedCountsByToolName)}`,
    '',
    'Top snapshot contributors',
    ...formatContributors(diagnostics.topSnapshotContributors),
    '',
    'Next-turn fixed context (before future user text)',
    `- Projected history before microcompact/prune: ${formatInt(diagnostics.historyTokens)}`,
    `- Projected history after microcompact/prune: ${formatMaybeInt(args.nextTurn?.projectedHistoryTokens ?? null)}`,
    `- Projected history delta vs snapshot: ${formatSignedMaybeInt(args.nextTurn?.projectedHistoryDeltaTokens ?? null)}`,
    `- Estimated tokens saved by microcompact: ${formatInt(args.nextTurn?.microCompactImpact.estimatedTokensSaved ?? 0)}`,
    `- Microcompact compacted blocks: ${formatInt(args.nextTurn?.microCompactImpact.compactedBlocks ?? 0)}`,
    `- Microcompact kept recent eligible blocks: ${formatInt(args.nextTurn?.microCompactImpact.keptRecentBlocks ?? 0)}`,
    `- Microcompact compacted tools: ${formatToolNames(args.nextTurn?.microCompactImpact.compactedToolNames ?? [])}`,
    `- Collapse applied for request projection: ${formatMaybeBool(args.nextTurn ? args.nextTurn.collapseImpact.collapsed : null)}`,
    `- Projected history after collapse: ${formatMaybeInt(args.nextTurn?.collapseImpact.projectedHistoryTokensAfterCollapse ?? null)}`,
    `- Projected history delta from collapse: ${formatSignedMaybeInt(args.nextTurn?.collapseImpact.projectedHistoryDeltaTokens ?? null)}`,
    `- Estimated tokens saved by collapse: ${formatInt(args.nextTurn?.collapseImpact.estimatedTokensSaved ?? 0)}`,
    `- Collapse collapsed older messages: ${formatInt(args.nextTurn?.collapseImpact.collapsedHeadMessageCount ?? 0)}`,
    `- Collapse recap metadata: ${formatCollapseMeta(args.nextTurn?.collapseImpact.metadata ?? null)}`,
    `- Working-set signals: ${formatWorkingSetSignals(args.nextTurn?.workingSetSignals ?? null)}`,
    `- Fixed additions total: ${formatMaybeInt(args.nextTurn?.fixedTokens ?? null)}`,
    ...formatFixedGroups(args.nextTurn?.fixedGroups ?? []),
    `- Assembled fixed total: ${formatMaybeInt(args.nextTurn?.totalTokens ?? null)}`,
    `- Remaining to effective limit before future user text: ${formatMaybeInt(args.nextTurn?.remainingToEffectiveLimit ?? null)}`,
    `- Remaining to auto-compact limit before future user text: ${formatMaybeInt(args.nextTurn?.remainingToAutoCompactLimit ?? null)}`,
    `- Auto-compact would trigger before future user text: ${formatMaybeBool(args.nextTurn?.shouldAutoCompact ?? null)}`,
    `- Auto-compact skip reason: ${args.nextTurn?.autoCompactSkipReason === null ? 'none (visible preconditions met)' : (args.nextTurn?.autoCompactSkipReason ?? 'unknown')}`,
    `- Prune skip reason: ${args.nextTurn?.pruneSkipReason === null ? 'none (prune applied)' : (args.nextTurn?.pruneSkipReason ?? 'unknown')}`,
    '',
    'Assembled payload ledger before future user text',
    ...formatAssembledLedger(args.nextTurn?.assembledLedger ?? []),
    '',
    'Lifecycle markers before future user text',
    ...formatLifecycleMarkers(args.nextTurn?.lifecycleMarkers ?? []),
    '',
    'Top assembled contributors before future user text',
    ...formatContributors(args.nextTurn?.topAssembledContributors ?? []),
    '',
    'Notes',
    ...formatNotes(args.notes ?? DEFAULT_CONTEXT_DIAGNOSTICS_NOTES),
  ]

  return lines.join('\n')
}

function formatKeepStrategy(value: CompactBoundaryMeta['keepStrategy'] | null): string {
  if (!value) return 'none'
  if (value.kind === 'keep_last_turns') {
    return `keep_last_turns(${formatInt(value.keepLastTurns)})`
  }
  if (value.kind === 'keep_combo') {
    return `keep_combo(turns=${formatInt(value.keepLastTurns)}, min_tokens=${formatInt(value.keepMinTokens)}, min_user_turns=${formatInt(value.keepMinUserTurns)})`
  }
  return 'unknown'
}

function formatRehydrationPlan(value: CompactBoundaryMeta['rehydrationPlan'] | null): string {
  if (!value || !Array.isArray(value.items) || value.items.length === 0) return 'none'
  return value.items.map((item) => `${item.kind}(${item.priority}/${item.status})`).join(', ')
}

function formatRehydrationCost(value: CompactBoundaryMeta['rehydrationCost'] | null): string {
  if (!value) return 'none'
  return `${formatInt(value.sectionCount)} sections / ${formatInt(value.estimatedTokens)} tokens`
}

function formatPreservedSegment(value: CompactBoundaryMeta['preservedSegment'] | null): string {
  if (!value) return 'none'
  return `continuation=${formatInt(value.continuationMessageCount)}, preserved_tail=${formatInt(value.preservedTailMessageCount)}, head=${value.headFingerprint ?? 'none'}, tail=${value.tailFingerprint ?? 'none'}`
}

function splitHistorySlices(
  messages: PromptMessage[],
  toolUsesById: Map<string, ToolUseMeta> = collectToolUsesById(messages),
): {
  toolResultMessages: PromptMessage[]
  nonToolMessages: PromptMessage[]
  toolResultBlockCount: number
  microCompactedToolResultCount: number
  toolResultCountsByToolName: Array<{ toolName: string; count: number }>
  microCompactedCountsByToolName: Array<{ toolName: string; count: number }>
} {
  const toolResultMessages: PromptMessage[] = []
  const nonToolMessages: PromptMessage[] = []
  let toolResultBlockCount = 0
  let microCompactedToolResultCount = 0
  const toolResultCountMap = new Map<string, number>()
  const microCompactedCountMap = new Map<string, number>()

  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue

    const toolBlocks = message.content.filter((block: any) => {
      return block?.type === 'tool_result'
    })
    const nonToolBlocks = message.content.filter((block: any) => {
      return block?.type !== 'tool_result'
    })

    if (toolBlocks.length > 0) {
      toolResultMessages.push({
        ...message,
        content: toolBlocks as any,
      })
      toolResultBlockCount += toolBlocks.length
      for (const block of toolBlocks as any[]) {
        const toolName = readToolNameForResult(toolUsesById, block)
        bumpCount(toolResultCountMap, toolName)
        if (toolResultContentToText(block?.content).startsWith(MICROCOMPACT_STUB_PREFIX)) {
          microCompactedToolResultCount += 1
          bumpCount(microCompactedCountMap, toolName)
        }
      }
    }

    if (nonToolBlocks.length > 0) {
      nonToolMessages.push({
        ...message,
        content: nonToolBlocks as any,
      })
    }
  }

  return {
    toolResultMessages,
    nonToolMessages,
    toolResultBlockCount,
    microCompactedToolResultCount,
    toolResultCountsByToolName: toSortedCounts(toolResultCountMap),
    microCompactedCountsByToolName: toSortedCounts(microCompactedCountMap),
  }
}

type ToolUseMeta = {
  name: string
  input: unknown
}

function collectToolUsesById(messages: PromptMessage[]): Map<string, ToolUseMeta> {
  const out = new Map<string, ToolUseMeta>()

  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      if (typeof block.id !== 'string' || typeof block.name !== 'string') continue
      out.set(block.id, {
        name: block.name,
        input: block.input,
      })
    }
  }

  return out
}

function readToolNameForResult(toolUsesById: Map<string, ToolUseMeta>, block: any): string {
  if (typeof block?.tool_use_id !== 'string') return 'Unknown'
  return toolUsesById.get(block.tool_use_id)?.name ?? 'Unknown'
}

function bumpCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function toSortedCounts(map: Map<string, number>): Array<{ toolName: string; count: number }> {
  return [...map.entries()]
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
}

function formatInt(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US')
}

function formatMaybeInt(value: number | null): string {
  return value == null ? 'unknown' : formatInt(value)
}

function formatMaybeBool(value: boolean | null): string {
  return value == null ? 'unknown' : value ? 'yes' : 'no'
}

function formatMaybePercent(value: number | null): string {
  return value == null ? 'unknown' : `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function formatCountsByToolName(rows: Array<{ toolName: string; count: number }>): string {
  if (rows.length === 0) return 'none'
  return rows.map((row) => `${row.toolName}=${formatInt(row.count)}`).join(', ')
}

function formatToolNames(value: string[]): string {
  if (value.length === 0) return 'none'
  return value.join(', ')
}

function formatSignedMaybeInt(value: number | null): string {
  if (value == null) return 'unknown'
  const rounded = Math.round(value)
  if (rounded > 0) return `+${formatInt(rounded)}`
  if (rounded < 0) return `-${formatInt(Math.abs(rounded))}`
  return '0'
}

function formatFixedGroups(rows: Array<{ label: string; blockCount: number; tokens: number }>): string[] {
  if (rows.length === 0) return ['- Fixed group breakdown: none']
  return rows.map((row) => `- ${row.label}: ${formatInt(row.tokens)} (${formatInt(row.blockCount)} blocks)`)
}

function formatAssembledLedger(rows: ContextAssembledLedgerRow[]): string[] {
  if (rows.length === 0) return ['- Assembled ledger: none']
  return rows.map((row) => {
    const details: string[] = []
    if (row.messageCount != null) details.push(`${formatInt(row.messageCount)} messages`)
    if (row.blockCount != null) details.push(`${formatInt(row.blockCount)} blocks`)
    return `- ${row.label}: ${formatInt(row.tokens)}${details.length > 0 ? ` (${details.join(', ')})` : ''}`
  })
}

function formatLifecycleMarkers(rows: ContextLifecycleMarker[]): string[] {
  if (rows.length === 0) return ['- Lifecycle markers: none']
  return rows.map(
    (row) =>
      `- ${row.label}: total=${formatInt(row.totalTokens)}, history=${formatInt(row.historyTokens)}, fixed=${formatInt(row.fixedTokens)}, delta=${formatSignedMaybeInt(row.deltaFromSnapshot)}, remaining_effective=${formatMaybeInt(row.remainingToEffectiveLimit)}, remaining_auto=${formatMaybeInt(row.remainingToAutoCompactLimit)}, auto=${formatMaybeBool(row.shouldAutoCompact)}`,
  )
}

function buildLifecycleMarkers(args: {
  system: PromptBlock[]
  snapshotHistory: PromptMessage[]
  microCompactedHistory: PromptMessage[]
  postPruneMessages: PromptMessage[]
  preparedFixedMessage: PromptMessage | null
  budgetConfig: ContextBudgetConfig | null
  cwd: string
  mode: 'normal' | 'acceptEdits' | 'plan'
  planPath: string | null
  keepLastTurns: number
}): ContextLifecycleMarker[] {
  const snapshotAssembled = args.preparedFixedMessage
    ? [...args.snapshotHistory, args.preparedFixedMessage]
    : [...args.snapshotHistory]
  const postMicrocompactAssembled = args.preparedFixedMessage
    ? [...args.microCompactedHistory, args.preparedFixedMessage]
    : [...args.microCompactedHistory]
  const postPruneAssembled = [...args.postPruneMessages]
  const postCompactAssembled = buildPostCompactAssembledMessages(args)
  const snapshotTotalTokens = estimatePromptTokens({ system: args.system, messages: snapshotAssembled })

  return [
    buildLifecycleMarker({
      stage: 'snapshot',
      label: 'snapshot',
      system: args.system,
      messages: snapshotAssembled,
      fixedMessage: args.preparedFixedMessage,
      budgetConfig: args.budgetConfig,
      snapshotTotalTokens,
    }),
    buildLifecycleMarker({
      stage: 'post_microcompact',
      label: 'post-microcompact',
      system: args.system,
      messages: postMicrocompactAssembled,
      fixedMessage: args.preparedFixedMessage,
      budgetConfig: args.budgetConfig,
      snapshotTotalTokens,
    }),
    buildLifecycleMarker({
      stage: 'post_prune',
      label: 'post-prune',
      system: args.system,
      messages: postPruneAssembled,
      fixedMessage: args.preparedFixedMessage,
      budgetConfig: args.budgetConfig,
      snapshotTotalTokens,
    }),
    buildLifecycleMarker({
      stage: 'post_compact',
      label: 'post-compact',
      system: args.system,
      messages: postCompactAssembled,
      fixedMessage: args.preparedFixedMessage,
      budgetConfig: args.budgetConfig,
      snapshotTotalTokens,
    }),
  ]
}

function buildLifecycleMarker(args: {
  stage: ContextLifecycleMarker['stage']
  label: string
  system: PromptBlock[]
  messages: PromptMessage[]
  fixedMessage: PromptMessage | null
  budgetConfig: ContextBudgetConfig | null
  snapshotTotalTokens: number
}): ContextLifecycleMarker {
  const totalTokens = estimatePromptTokens({ system: args.system, messages: args.messages })
  const fixedTokens = args.fixedMessage ? estimatePromptTokens({ system: [], messages: [args.fixedMessage] }) : 0
  const historyTokens = Math.max(0, estimatePromptTokens({ system: [], messages: args.messages }) - fixedTokens)
  const budget = args.budgetConfig ? computeContextBudget(args.budgetConfig) : null
  const stats = args.budgetConfig
    ? computeContextStats({
        config: args.budgetConfig,
        usedTokens: totalTokens,
      })
    : null

  return {
    stage: args.stage,
    label: args.label,
    totalTokens,
    historyTokens,
    fixedTokens,
    deltaFromSnapshot: totalTokens - args.snapshotTotalTokens,
    remainingToEffectiveLimit: budget ? Math.max(0, budget.effectiveLimitTokens - totalTokens) : null,
    remainingToAutoCompactLimit: budget ? Math.max(0, budget.autoCompactLimitTokens - totalTokens) : null,
    shouldAutoCompact: stats?.shouldAutoCompact ?? null,
  }
}

function buildPostCompactAssembledMessages(args: {
  system: PromptBlock[]
  microCompactedHistory: PromptMessage[]
  preparedFixedMessage: PromptMessage | null
  budgetConfig: ContextBudgetConfig | null
  cwd: string
  mode: 'normal' | 'acceptEdits' | 'plan'
  planPath: string | null
  keepLastTurns: number
}): PromptMessage[] {
  const compactionScope = resolveHistoryForCompaction({
    previousHistory: args.microCompactedHistory,
    allowPartial: true,
  })
  const draft = buildSessionMemoryDraft({
    cwd: args.cwd,
    mode: args.mode,
    planPath: args.planPath,
    previousHistory: compactionScope.history,
  })
  const fallbackRehydration = buildPostCompactRehydration({
    cwd: args.cwd,
    mode: args.mode,
    planPath: args.planPath,
    previousHistory: compactionScope.history,
  })
  const rehydration = buildSessionMemoryCompactionRehydration({
    draft,
    fallback: fallbackRehydration,
  })
  const keepStrategy = buildWorkingSetAwareAutoCompactKeepStrategy({
    keepLastTurns: args.keepLastTurns,
    mode: args.mode,
    rehydration,
  })
  const rehydrationPlan = markCompactRehydrationApplied(
    draft.currentStrategy.rehydrationPlan ??
      buildDefaultCompactRehydrationPlan({
        mode: args.mode,
        planPath: args.planPath,
        hasTodoState: Boolean(rehydration.todoSummary),
      }),
    [
      ...(rehydration.recentFiles.length > 0 ? (['recent_files'] as const) : []),
      ...(rehydration.modeText ? (['mode_state'] as const) : []),
      ...(rehydration.planPath || rehydration.planExcerpt ? (['plan_state'] as const) : []),
      ...(rehydration.todoSummary ? (['todo_state'] as const) : []),
    ],
  )
  const summary = buildSessionMemoryCompactionSummary(draft).trim() || 'Session memory recap unavailable.'
  const compactedHistory = rebuildHistoryAfterCompaction({
    summary,
    previousHistory: compactionScope.history,
    tailSourceHistory: compactionScope.tailSourceHistory,
    keepStrategy,
    rehydration,
    boundaryMeta: {
      trigger: 'auto',
      preTokens: estimatePromptTokens({
        system: args.system,
        messages: args.microCompactedHistory,
      }),
      summaryKind: 'session_memory',
      keepStrategy,
      rehydrationPlan,
      rehydrationCost: estimateCompactRehydrationCost(rehydration),
    },
  })
  const compactedContinuation = getContinuationMessagesAfterLatestCompactBoundary(compactedHistory)
  const assembledMessages = args.preparedFixedMessage
    ? [...compactedContinuation, args.preparedFixedMessage]
    : compactedContinuation

  if (!args.budgetConfig) return assembledMessages
  return pruneForPromptBudget({
    system: args.system,
    messages: assembledMessages,
    ...args.budgetConfig,
  }).messages
}

function normalizeDiagnosticsMode(mode: string): 'normal' | 'acceptEdits' | 'plan' {
  if (mode === 'acceptEdits' || mode === 'plan') return mode
  return 'normal'
}

function buildTopSnapshotContributors(args: {
  systemSectionBreakdown: ContextContributor[]
  messages: PromptMessage[]
  toolUsesById: Map<string, ToolUseMeta>
}): ContextContributor[] {
  return sortContributors([
    ...args.systemSectionBreakdown,
    ...buildHistoryContributors({
      messages: args.messages,
      toolUsesById: args.toolUsesById,
    }),
  ]).slice(0, TOP_CONTRIBUTOR_LIMIT)
}

function buildTopAssembledContributors(args: {
  system: PromptBlock[]
  projectedHistory: PromptMessage[]
  projectedToolUsesById: Map<string, ToolUseMeta>
  fixedGroups: Array<{ label: string; blocks: PromptBlock[] }>
}): ContextContributor[] {
  return sortContributors([
    ...buildSystemSectionContributors(args.system),
    ...buildHistoryContributors({
      messages: args.projectedHistory,
      toolUsesById: args.projectedToolUsesById,
    }),
    ...args.fixedGroups.map((group, index) => ({
      kind: 'fixed_group' as const,
      key: `fixed_group:${index}:${sanitizeContributorKey(group.label)}`,
      label: `Fixed: ${group.label}`,
      tokens: estimatePromptTokens({
        system: [],
        messages: [{ role: 'user', content: group.blocks }],
      }),
    })),
  ]).slice(0, TOP_CONTRIBUTOR_LIMIT)
}

function buildSystemSectionContributors(system: PromptBlock[]): ContextContributor[] {
  const contributors: ContextContributor[] = []
  const otherBlocks: PromptBlock[] = []
  let textBlockOrdinal = 0

  for (const block of system) {
    const text = readSystemTextBlock(block)
    if (text) {
      const sections = splitSystemTextIntoSections(text, textBlockOrdinal)
      textBlockOrdinal += 1
      for (const section of sections) {
        const tokens = estimatePromptTokens({
          system: [{ type: 'text', text: section.text }],
          messages: [],
        })
        if (tokens <= 0) continue
        contributors.push({
          kind: 'system_section',
          key: `system_section:${section.key}`,
          label: section.label,
          tokens,
          systemSectionKey: section.key,
        })
      }
      continue
    }
    otherBlocks.push(block)
  }

  if (otherBlocks.length > 0) {
    const otherTokens = estimatePromptTokens({
      system: otherBlocks,
      messages: [],
    })
    if (otherTokens > 0) {
      contributors.push({
        kind: 'system_section',
        key: 'system_section:other_blocks',
        label: 'System section: Other blocks',
        tokens: otherTokens,
        systemSectionKey: 'other_blocks',
      })
    }
  }

  return contributors
}

function readSystemTextBlock(block: PromptBlock): string | null {
  if (!block || block.type !== 'text') return null
  return typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : null
}

function splitSystemTextIntoSections(text: string, textBlockOrdinal: number): Array<{ key: string; label: string; text: string }> {
  const normalized = String(text ?? '').trim()
  if (!normalized) return []

  const topLevelHeadingPattern = /^# [^\n]+$/gm
  const headingMatches = Array.from(normalized.matchAll(topLevelHeadingPattern))
  const sections: Array<{ key: string; label: string; text: string }> = []
  const headingOccurrenceMap = new Map<string, number>()

  if (headingMatches.length === 0) {
    sections.push({
      key: textBlockOrdinal === 0 ? 'identity' : `preamble:${textBlockOrdinal}`,
      label: textBlockOrdinal === 0 ? 'System section: Identity' : 'System section: Preamble',
      text: normalized,
    })
    return sections
  }

  const firstHeadingIndex = headingMatches[0]?.index ?? 0
  if (firstHeadingIndex > 0) {
    const preamble = normalized.slice(0, firstHeadingIndex).trim()
    if (preamble) {
      sections.push({
        key: `preamble:${textBlockOrdinal}`,
        label: 'System section: Preamble',
        text: preamble,
      })
    }
  }

  for (let i = 0; i < headingMatches.length; i += 1) {
    const match = headingMatches[i]
    const start = match.index ?? 0
    const end = headingMatches[i + 1]?.index ?? normalized.length
    const sectionText = normalized.slice(start, end).trim()
    if (!sectionText) continue
    const heading = match[0].replace(/^# /, '').trim() || 'Preamble'
    const headingSlug = sanitizeContributorKey(heading || 'Preamble')
    const occurrence = (headingOccurrenceMap.get(headingSlug) ?? 0) + 1
    headingOccurrenceMap.set(headingSlug, occurrence)
    sections.push({
      key: `section:${textBlockOrdinal}:${headingSlug}:${occurrence}`,
      label: `System section: ${heading}`,
      text: sectionText,
    })
  }

  return sections
}

function buildHistoryContributors(args: {
  messages: PromptMessage[]
  toolUsesById: Map<string, ToolUseMeta>
}): ContextContributor[] {
  const contributors: ContextContributor[] = []
  let userOrdinal = 0
  let assistantOrdinal = 0

  for (const message of args.messages) {
    if (!message || !Array.isArray(message.content)) continue

    if (message.role === 'user') userOrdinal += 1
    if (message.role === 'assistant') assistantOrdinal += 1

    const roleOrdinal = message.role === 'assistant' ? assistantOrdinal : message.role === 'user' ? userOrdinal : 0

    for (const [blockIndex, block] of (message.content as any[]).entries()) {
      if (block?.type !== 'tool_result') continue
      const toolUseId = typeof block?.tool_use_id === 'string' ? block.tool_use_id : undefined
      const toolName = readToolNameForResult(args.toolUsesById, block)
      contributors.push({
        kind: 'tool_result',
        key: toolUseId ? `tool_result:${toolUseId}:${blockIndex}` : `tool_result:unknown:${roleOrdinal}:${blockIndex}`,
        label: buildToolResultContributorLabel(args.toolUsesById, block),
        tokens: estimatePromptTokens({
          system: [],
          messages: [{ ...message, content: [block] as any }],
        }),
        role: message.role,
        ordinal: roleOrdinal,
        ...(toolUseId ? { toolUseId } : {}),
        ...(toolName ? { toolName } : {}),
      })
    }

    const nonToolBlocks = (message.content as any[]).filter((block) => block?.type !== 'tool_result')
    if (nonToolBlocks.length === 0) continue
    const collapseRecap = message.role === 'user' ? readCollapseRecapMeta(nonToolBlocks) : null
    contributors.push({
      kind: collapseRecap ? 'collapse_recap' : 'message',
      key: collapseRecap
        ? `collapse_recap:${message.role}:${Math.max(1, roleOrdinal)}`
        : `message:${message.role}:${Math.max(1, roleOrdinal)}`,
      label: collapseRecap
        ? buildCollapseRecapContributorLabel({
            ordinal: roleOrdinal,
            collapsedHeadMessageCount: collapseRecap.collapsedHeadMessageCount,
          })
        : buildMessageContributorLabel({
            role: message.role,
            ordinal: roleOrdinal,
            blocks: nonToolBlocks,
          }),
      tokens: estimatePromptTokens({
        system: [],
        messages: [{ ...message, content: nonToolBlocks as any }],
      }),
      role: message.role,
      ordinal: roleOrdinal,
    })
  }

  return contributors.filter((row) => row.tokens > 0)
}

function readCollapseRecapMeta(blocks: any[]): { collapsedHeadMessageCount: number | null } | null {
  const text = readCollapseRecapText(blocks)
  if (!text) return null
  const match = /Earlier messages collapsed:\s*(\d+)/i.exec(text)
  const collapsedHeadMessageCount = match ? Number.parseInt(match[1] ?? '', 10) : NaN
  return {
    collapsedHeadMessageCount: Number.isFinite(collapsedHeadMessageCount) ? collapsedHeadMessageCount : null,
  }
}

function readCollapseRecapText(blocks: any[]): string | null {
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const text = unwrapSystemReminder(block.text)
    if (text.startsWith(CONTEXT_COLLAPSE_PREFIX)) return text
  }
  return null
}

function buildCollapseRecapContributorLabel(args: {
  ordinal: number
  collapsedHeadMessageCount: number | null
}): string {
  if (args.collapsedHeadMessageCount != null) {
    return `Collapse recap #${Math.max(1, args.ordinal)}: older continuation summary (${args.collapsedHeadMessageCount} messages)`
  }
  return `Collapse recap #${Math.max(1, args.ordinal)}: older continuation summary`
}

function buildToolResultContributorLabel(toolUsesById: Map<string, ToolUseMeta>, block: any): string {
  if (typeof block?.tool_use_id !== 'string') return 'Tool result: Unknown'
  const meta = toolUsesById.get(block.tool_use_id)
  if (!meta) return 'Tool result: Unknown'
  const summary = summarizeToolUse(meta)
  return summary ? `Tool result: ${summary}` : `Tool result: ${meta.name}`
}

function buildMessageContributorLabel(args: {
  role: PromptMessage['role']
  ordinal: number
  blocks: any[]
}): string {
  const roleLabel = args.role === 'assistant' ? 'Assistant' : args.role === 'user' ? 'User' : 'Message'
  const preview = readBlockPreview(args.blocks)
  if (preview) {
    return `${roleLabel} message #${Math.max(1, args.ordinal)}: "${preview}"`
  }
  const kinds = [...new Set(args.blocks.map((block) => String(block?.type ?? 'unknown')))]
  return `${roleLabel} message #${Math.max(1, args.ordinal)} (${kinds.join(', ')})`
}

function readBlockPreview(blocks: any[]): string | null {
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return truncateLabel(unwrapSystemReminder(block.text))
    }
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      return truncateLabel(`tool_use ${block.name}`)
    }
  }
  return null
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  return String(match ? match[1] ?? '' : raw).trim()
}

function summarizeToolUse(meta: ToolUseMeta): string {
  const input = readObject(meta.input)
  if (meta.name === 'Read') {
    const filePath = readStringField(input, 'file_path') ?? readStringField(input, 'path')
    return filePath ? `Read ${truncateLabel(filePath)}` : 'Read'
  }
  if (meta.name === 'Grep') {
    const pattern = readStringField(input, 'pattern')
    const path = readStringField(input, 'path')
    if (pattern && path) return `Grep "${truncateLabel(pattern, 24)}" in ${truncateLabel(path, 36)}`
    if (pattern) return `Grep "${truncateLabel(pattern, 24)}"`
    return 'Grep'
  }
  if (meta.name === 'Glob') {
    const pattern = readStringField(input, 'pattern')
    const path = readStringField(input, 'path')
    if (pattern && path) return `Glob "${truncateLabel(pattern, 24)}" in ${truncateLabel(path, 36)}`
    if (pattern) return `Glob "${truncateLabel(pattern, 24)}"`
    return 'Glob'
  }
  return truncateLabel(meta.name, 48)
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readStringField(input: Record<string, unknown> | null, key: string): string | null {
  const value = input?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function truncateLabel(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function sanitizeContributorKey(value: string): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'unknown'
}

function sortContributors(rows: ContextContributor[]): ContextContributor[] {
  return rows
    .filter((row) => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key) || a.label.localeCompare(b.label))
}

function formatContributors(rows: ContextContributor[]): string[] {
  if (rows.length === 0) return ['- Top contributors: none']
  return rows.map((row) => `- ${row.label}: ${formatInt(row.tokens)}`)
}

function formatCollapseMeta(value: ContextCollapseMeta | null): string {
  if (!value) return 'none'
  return [
    `keep_last_turns=${formatInt(value.keepLastTurns)}`,
    `preserved_tail=${formatInt(value.preservedTailMessageCount)}`,
    `compact_summary=${value.retainedCompactSummary ? 'yes' : 'no'}`,
    `recent_prompts=${formatInt(value.recentUserPromptCount)}`,
    `recent_files=${formatInt(value.recentFileCount)}`,
    `tool_results=${formatInt(value.earlierToolResultBlockCount)}`,
    `fingerprint=${value.recapFingerprint}`,
  ].join(', ')
}

function formatWorkingSetSignals(value: AutoCompactWorkingSetSignals | null): string {
  if (!value) return 'none'
  return [
    `recent_files=${formatInt(value.recentFileCount)}`,
    `plan_state=${value.hasPlanState ? 'yes' : 'no'}`,
    `todo_state=${value.hasTodoState ? 'yes' : 'no'}`,
    `mode_state=${value.modeState}`,
    `keep_tokens_boost=${formatInt(value.keepMinTokensBoost)}`,
    `keep_user_turns_boost=${formatInt(value.keepMinUserTurnsBoost)}`,
    `anchor_kind=${value.anchorKind}`,
    `anchor_tools=${value.anchorToolNames.length > 0 ? value.anchorToolNames.join('+') : 'none'}`,
    `anchor_backtrack_turns=${formatInt(value.anchorBacktrackTurns)}`,
  ].join(', ')
}

function formatNotes(notes: readonly string[]): string[] {
  return notes.map((note) => `- ${note}`)
}
