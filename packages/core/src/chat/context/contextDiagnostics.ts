import type { ContextBudgetConfig } from './budget'
import { computeContextBudget, computeContextStats } from './budget'
import { estimatePromptTokens } from './estimate'
import { getKnownContextWindowTokens } from './modelWindow'
import { MICROCOMPACT_STUB_PREFIX } from './microCompact'
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
}

export function analyzeContextDiagnostics(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  budgetConfig?: ContextBudgetConfig | null
}): ContextDiagnostics {
  const systemTokens = estimatePromptTokens({ system: args.system, messages: [] })
  const historyTokens = estimatePromptTokens({ system: [], messages: args.messages })
  const totalTokens = estimatePromptTokens({ system: args.system, messages: args.messages })
  const split = splitHistorySlices(args.messages)
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
    messageCount: args.messages.length,
    userMessageCount: args.messages.filter((message) => message?.role === 'user').length,
    assistantMessageCount: args.messages.filter((message) => message?.role === 'assistant').length,
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
  }
}

export function buildContextDiagnosticsReport(args: {
  cwd: string
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: string
  messages: PromptMessage[]
}): string {
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

  return formatContextDiagnosticsReport({
    diagnostics,
    mode: args.mode,
    model: args.cfg.llm.model,
  })
}

export function formatContextDiagnosticsReport(args: {
  diagnostics: ContextDiagnostics
  mode: string
  model: string
}): string {
  const { diagnostics } = args
  const lines = [
    'Context diagnostics',
    '- Snapshot: current persisted prompt history only (excludes /context and next-turn injected blocks)',
    `- Mode: ${args.mode}`,
    `- Model: ${args.model || 'unknown'}`,
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
    'Notes',
    '- Tool-result and other-history slices are approximate because token estimation is JSON-size based.',
  ]

  return lines.join('\n')
}

function splitHistorySlices(messages: PromptMessage[]): {
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
  const toolUsesById = collectToolUsesById(messages)
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

function collectToolUsesById(messages: PromptMessage[]): Map<string, string> {
  const out = new Map<string, string>()

  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      if (typeof block.id !== 'string' || typeof block.name !== 'string') continue
      out.set(block.id, block.name)
    }
  }

  return out
}

function readToolNameForResult(toolUsesById: Map<string, string>, block: any): string {
  if (typeof block?.tool_use_id !== 'string') return 'Unknown'
  return toolUsesById.get(block.tool_use_id) ?? 'Unknown'
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
