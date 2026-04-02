import type { ContextBudgetConfig } from './budget'
import { computeContextBudget, computeContextStats } from './budget'
import { estimatePromptTokens } from './estimate'
import { MICROCOMPACT_STUB_PREFIX } from './microCompact'
import type { PromptBlock, PromptMessage } from '../../prompts'
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
} {
  const toolResultMessages: PromptMessage[] = []
  const nonToolMessages: PromptMessage[] = []
  let toolResultBlockCount = 0
  let microCompactedToolResultCount = 0

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
        if (toolResultContentToText(block?.content).startsWith(MICROCOMPACT_STUB_PREFIX)) {
          microCompactedToolResultCount += 1
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
  }
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
