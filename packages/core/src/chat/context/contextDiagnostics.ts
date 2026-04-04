import type { ContextBudgetConfig } from './budget'
import { computeContextBudget, computeContextStats } from './budget'
import { estimatePromptTokens } from './estimate'
import { getKnownContextWindowTokens } from './modelWindow'
import { MICROCOMPACT_STUB_PREFIX } from './microCompact'
import { microCompactHistory, type MicroCompactImpact } from './microCompact'
import { pruneForPromptBudget } from './prune'
import {
  findLatestCompactBoundary,
  type CompactBoundaryMeta,
  stripCompactBoundaryMessages,
} from './compact'
import type { RuntimeConfig } from '../../config/config'
import type { RuntimeFlags } from '../../config/runtimeFlags'
import type { PromptBlock, PromptMessage } from '../../prompts'
import { buildSystemPrompt } from '../../prompts'
import { resolveSystemPromptVariant } from '../../prompts/system'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'

export type ContextDiagnostics = {
  totalTokens: number
  systemTokens: number
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
  microCompactImpact: MicroCompactImpact
  projectedHistoryTokens: number
  projectedHistoryDeltaTokens: number
  fixedTokens: number
  totalTokens: number
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
  topAssembledContributors: ContextContributor[]
}

export type ContextContributor = {
  label: string
  tokens: number
}

export type ContextDiagnosticsPayload = {
  kind: 'formax.context_diagnostics'
  schemaVersion: 1
  mode: string
  model: string
  latestCompactBoundary: CompactBoundaryMeta | null
  snapshot: ContextDiagnostics
  nextTurnFixed: NextTurnFixedContextDiagnostics
  notes: string[]
}

export type ContextDiagnosticsOutputFormat = 'text' | 'json'

const DEFAULT_CONTEXT_DIAGNOSTICS_NOTES = [
  'Tool-result and other-history slices are approximate because token estimation is JSON-size based.',
  'Next-turn fixed context is a non-destructive projection: it includes current microcompact/prune rules and auto-injected blocks, but does not execute full auto-compact or invent future user text.',
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
  const promptMessages = stripCompactBoundaryMessages(args.messages)
  const toolUsesById = collectToolUsesById(promptMessages)
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
      system: args.system,
      messages: promptMessages,
      toolUsesById,
    }),
  }
}

export function analyzeNextTurnFixedContext(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  fixedGroups: NextTurnFixedContextGroup[]
  budgetConfig?: ContextBudgetConfig | null
}): NextTurnFixedContextDiagnostics {
  const promptMessages = stripCompactBoundaryMessages(args.messages)
  const fixedGroups = args.fixedGroups
    .map((group) => ({
      label: group.label,
      blocks: Array.isArray(group.blocks) ? group.blocks : [],
    }))
    .filter((group) => group.blocks.length > 0)

  const microCompactResult = microCompactHistory({ messages: promptMessages })
  const microCompactedHistory = microCompactResult.messages
  const fixedUserMessage =
    fixedGroups.length > 0
      ? ({
          role: 'user' as const,
          content: fixedGroups.flatMap((group) => group.blocks),
        } satisfies PromptMessage)
      : null

  const rawPreparedMessages = fixedUserMessage ? [...microCompactedHistory, fixedUserMessage] : [...microCompactedHistory]
  const preparedMessages = args.budgetConfig
    ? pruneForPromptBudget({
        system: args.system,
        messages: rawPreparedMessages,
        ...args.budgetConfig,
      }).messages
    : rawPreparedMessages

  const projectedHistory = fixedUserMessage ? preparedMessages.slice(0, -1) : preparedMessages
  const preparedFixedMessage = fixedUserMessage ? (preparedMessages[preparedMessages.length - 1] ?? fixedUserMessage) : null
  const assembledMessages = preparedFixedMessage ? [...projectedHistory, preparedFixedMessage] : projectedHistory
  const projectedToolUsesById = collectToolUsesById(projectedHistory)

  const totalTokens = estimatePromptTokens({ system: args.system, messages: assembledMessages })
  const projectedHistoryTokens = estimatePromptTokens({ system: [], messages: projectedHistory })
  const snapshotHistoryTokens = estimatePromptTokens({ system: [], messages: promptMessages })
  const fixedTokens = preparedFixedMessage ? estimatePromptTokens({ system: [], messages: [preparedFixedMessage] }) : 0
  const stats = args.budgetConfig
    ? computeContextStats({
        config: args.budgetConfig,
        usedTokens: totalTokens,
      })
    : null
  const budget = args.budgetConfig ? computeContextBudget(args.budgetConfig) : null

  return {
    fixedGroups: fixedGroups.map((group) => ({
      label: group.label,
      blockCount: group.blocks.length,
      tokens: estimatePromptTokens({
        system: [],
        messages: [{ role: 'user', content: group.blocks }],
      }),
    })),
    microCompactImpact: {
      compactedBlocks: microCompactResult.compactedBlocks,
      compactedToolNames: microCompactResult.compactedToolNames,
      estimatedTokensSaved: microCompactResult.estimatedTokensSaved,
      keptRecentBlocks: microCompactResult.keptRecentBlocks,
    },
    projectedHistoryTokens,
    projectedHistoryDeltaTokens: projectedHistoryTokens - snapshotHistoryTokens,
    fixedTokens,
    totalTokens,
    remainingToEffectiveLimit: budget ? Math.max(0, budget.effectiveLimitTokens - totalTokens) : null,
    remainingToAutoCompactLimit: budget ? Math.max(0, budget.autoCompactLimitTokens - totalTokens) : null,
    shouldAutoCompact: stats?.shouldAutoCompact ?? null,
    topAssembledContributors: buildTopAssembledContributors({
      system: args.system,
      projectedHistory,
      projectedToolUsesById,
      fixedGroups,
    }),
  }
}

export function buildContextDiagnosticsReport(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
}): string {
  const payload = buildContextDiagnosticsPayload(args)
  return formatContextDiagnosticsReport({
    latestCompactBoundary: payload.latestCompactBoundary,
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
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
}): string {
  return JSON.stringify(buildContextDiagnosticsPayload(args), null, 2)
}

export function buildContextDiagnosticsPayload(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  messages: PromptMessage[]
  nextTurnFixedGroups?: NextTurnFixedContextGroup[]
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
    snapshot: diagnostics,
    nextTurnFixed: nextTurn,
    notes: [...DEFAULT_CONTEXT_DIAGNOSTICS_NOTES],
  }
}

export function formatContextDiagnosticsReport(args: {
  latestCompactBoundary?: CompactBoundaryMeta | null
  diagnostics: ContextDiagnostics
  nextTurn?: NextTurnFixedContextDiagnostics | null
  mode: string
  model: string
  notes?: string[]
}): string {
  const { diagnostics } = args
  const lines = [
    'Context diagnostics',
    '- Snapshot: current persisted prompt history only (excludes /context and next-turn injected blocks)',
    `- Mode: ${args.mode}`,
    `- Model: ${args.model || 'unknown'}`,
    '',
    'Latest compact boundary',
    `- Trigger: ${args.latestCompactBoundary?.trigger ?? 'none'}`,
    `- Pre-compact tokens: ${formatMaybeInt(args.latestCompactBoundary?.preTokens ?? null)}`,
    `- Summary kind: ${args.latestCompactBoundary?.summaryKind ?? 'none'}`,
    `- Keep strategy: ${formatKeepStrategy(args.latestCompactBoundary?.keepStrategy ?? null)}`,
    `- Rehydration plan: ${formatRehydrationPlan(args.latestCompactBoundary?.rehydrationPlan ?? null)}`,
    `- Rehydration cost: ${formatRehydrationCost(args.latestCompactBoundary?.rehydrationCost ?? null)}`,
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
    `- Fixed additions total: ${formatMaybeInt(args.nextTurn?.fixedTokens ?? null)}`,
    ...formatFixedGroups(args.nextTurn?.fixedGroups ?? []),
    `- Assembled fixed total: ${formatMaybeInt(args.nextTurn?.totalTokens ?? null)}`,
    `- Remaining to effective limit before future user text: ${formatMaybeInt(args.nextTurn?.remainingToEffectiveLimit ?? null)}`,
    `- Remaining to auto-compact limit before future user text: ${formatMaybeInt(args.nextTurn?.remainingToAutoCompactLimit ?? null)}`,
    `- Auto-compact would trigger before future user text: ${formatMaybeBool(args.nextTurn?.shouldAutoCompact ?? null)}`,
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

function buildTopSnapshotContributors(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  toolUsesById: Map<string, ToolUseMeta>
}): ContextContributor[] {
  return sortContributors([
    {
      label: 'System prompt',
      tokens: estimatePromptTokens({ system: args.system, messages: [] }),
    },
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
    {
      label: 'System prompt',
      tokens: estimatePromptTokens({ system: args.system, messages: [] }),
    },
    ...buildHistoryContributors({
      messages: args.projectedHistory,
      toolUsesById: args.projectedToolUsesById,
    }),
    ...args.fixedGroups.map((group) => ({
      label: `Fixed: ${group.label}`,
      tokens: estimatePromptTokens({
        system: [],
        messages: [{ role: 'user', content: group.blocks }],
      }),
    })),
  ]).slice(0, TOP_CONTRIBUTOR_LIMIT)
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

    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_result') continue
      contributors.push({
        label: buildToolResultContributorLabel(args.toolUsesById, block),
        tokens: estimatePromptTokens({
          system: [],
          messages: [{ ...message, content: [block] as any }],
        }),
      })
    }

    const nonToolBlocks = (message.content as any[]).filter((block) => block?.type !== 'tool_result')
    if (nonToolBlocks.length === 0) continue
    contributors.push({
      label: buildMessageContributorLabel({
        role: message.role,
        ordinal: roleOrdinal,
        blocks: nonToolBlocks,
      }),
      tokens: estimatePromptTokens({
        system: [],
        messages: [{ ...message, content: nonToolBlocks as any }],
      }),
    })
  }

  return contributors.filter((row) => row.tokens > 0)
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
      return truncateLabel(block.text.trim())
    }
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      return truncateLabel(`tool_use ${block.name}`)
    }
  }
  return null
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

function sortContributors(rows: ContextContributor[]): ContextContributor[] {
  return rows
    .filter((row) => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label))
}

function formatContributors(rows: ContextContributor[]): string[] {
  if (rows.length === 0) return ['- Top contributors: none']
  return rows.map((row) => `- ${row.label}: ${formatInt(row.tokens)}`)
}

function formatNotes(notes: readonly string[]): string[] {
  return notes.map((note) => `- ${note}`)
}
