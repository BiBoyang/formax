import { computeContextBudget, type ContextBudgetConfig } from './budget'
import type { PromptMessage } from '../../prompts'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'
import { isDurableToolResultContentReplacement } from './durableToolResultContentReplacementMeta'

export const TOOL_RESULT_BUDGET_STUB_PREFIX = '[Tool result replaced by budget:'
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 2
const DEFAULT_MIN_RESULT_CHARS = 1200
const DEFAULT_MAX_STUB_CHARS = 120
const DEFAULT_ELIGIBLE_TOOL_NAMES = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'] as const
const SAFE_BASH_COMMANDS = [
  'cat',
  'head',
  'tail',
  'ls',
  'grep',
  'rg',
  'git status',
  'git diff',
  'git show',
  'wc',
  'pwd',
  'which',
  'stat',
] as const
const BASH_DISALLOWED_PATTERNS = ['&&', '&', '||', ';', '|', '>', '>>', '$(', '`', '\n', '\r'] as const
const SAFE_WEBFETCH_HOSTS = new Set([
  'developer.mozilla.org',
  'docs.anthropic.com',
  'docs.github.com',
  'platform.openai.com',
  'help.openai.com',
  'react.dev',
  'nextjs.org',
  'vite.dev',
  'nodejs.org',
  'bun.sh',
  'typescriptlang.org',
])

type ToolUseMeta = {
  name: string
  input: Record<string, unknown>
}

type EligibleToolResultRef = {
  messageIndex: number
  blockIndex: number
  toolUseId: string
  tool: ToolUseMeta
  rawResultText: string
  rawTokens: number
}

export type AdaptiveToolResultBudgetPolicy = {
  pressureTier: 'default' | 'relaxed' | 'steady' | 'tight' | 'critical'
  eligibleToolNames: string[]
  keepRecentToolResults: number
  minResultChars: number
  minResultCharsByName: Record<string, number>
  maxToolResultTokens: number | null
}

export type ToolResultBudgetImpact = {
  replacedBlocks: number
  replacedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
  budgetTokens: number | null
  totalToolResultTokensBefore: number
  totalToolResultTokensAfter: number
}

export function resolveAdaptiveToolResultBudgetPolicy(args: {
  pressureRatio?: number | null
  budgetConfig?: ContextBudgetConfig | null
}): AdaptiveToolResultBudgetPolicy {
  const ratio = Number.isFinite(args.pressureRatio) ? Math.max(0, args.pressureRatio!) : null
  const effectiveLimitTokens = args.budgetConfig ? computeContextBudget(args.budgetConfig).effectiveLimitTokens : null
  const withBudget = (
    pressureTier: AdaptiveToolResultBudgetPolicy['pressureTier'],
    keepRecentToolResults: number,
    minResultChars: number,
    minResultCharsByName: Record<string, number>,
    budgetPercent: number,
    minBudgetTokens: number,
  ): AdaptiveToolResultBudgetPolicy => ({
    pressureTier,
    eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES],
    keepRecentToolResults,
    minResultChars,
    minResultCharsByName,
    maxToolResultTokens:
      effectiveLimitTokens == null ? null : Math.max(minBudgetTokens, Math.floor(effectiveLimitTokens * budgetPercent)),
  })

  if (ratio == null) {
    return withBudget('default', 2, DEFAULT_MIN_RESULT_CHARS, { Bash: 1600, WebFetch: 1600 }, 0.22, 4000)
  }
  if (ratio < 0.5) {
    return withBudget('relaxed', 2, 1600, { Bash: 2000, WebFetch: 2000 }, 0.26, 5000)
  }
  if (ratio < 0.75) {
    return withBudget('steady', 2, 1200, { Grep: 900, Glob: 900, Bash: 1600, WebFetch: 1600 }, 0.2, 3600)
  }
  if (ratio < 0.9) {
    return withBudget('tight', 1, 900, { Grep: 700, Glob: 700, Bash: 1400, WebFetch: 1400 }, 0.15, 2600)
  }
  return withBudget('critical', 1, 700, { Grep: 600, Glob: 600, Bash: 1200, WebFetch: 1200 }, 0.1, 1800)
}

export function applyToolResultBudget(args: {
  messages: PromptMessage[]
  policy: AdaptiveToolResultBudgetPolicy
}): {
  messages: PromptMessage[]
  applied: boolean
  impact: ToolResultBudgetImpact
} {
  const toolUsesById = collectToolUsesById(args.messages)
  const totalToolResultTokensBefore = estimateToolResultGroupTokens(args.messages)
  const eligibleBlocks = collectEligibleToolResults({
    messages: args.messages,
    eligibleToolNames: new Set(args.policy.eligibleToolNames),
    minResultChars: args.policy.minResultChars,
    minResultCharsByName: args.policy.minResultCharsByName,
    toolUsesById,
  })

  if (
    args.policy.maxToolResultTokens == null ||
    totalToolResultTokensBefore <= args.policy.maxToolResultTokens ||
    eligibleBlocks.length === 0
  ) {
    return {
      messages: args.messages,
      applied: false,
      impact: {
        replacedBlocks: 0,
        replacedToolNames: [],
        estimatedTokensSaved: 0,
        keptRecentBlocks: eligibleBlocks.length,
        budgetTokens: args.policy.maxToolResultTokens,
        totalToolResultTokensBefore,
        totalToolResultTokensAfter: totalToolResultTokensBefore,
      },
    }
  }

  const refsToReplace = eligibleBlocks.slice(0, Math.max(0, eligibleBlocks.length - args.policy.keepRecentToolResults))
  if (refsToReplace.length === 0) {
    return {
      messages: args.messages,
      applied: false,
      impact: {
        replacedBlocks: 0,
        replacedToolNames: [],
        estimatedTokensSaved: 0,
        keptRecentBlocks: eligibleBlocks.length,
        budgetTokens: args.policy.maxToolResultTokens,
        totalToolResultTokensBefore,
        totalToolResultTokensAfter: totalToolResultTokensBefore,
      },
    }
  }

  const patchedMessages = [...args.messages]
  const patchedByIndex = new Map<number, PromptMessage>()
  const replacedToolNames: string[] = []
  const replacedToolNameSet = new Set<string>()
  let totalToolResultTokensAfter = totalToolResultTokensBefore
  let estimatedTokensSaved = 0
  let replacedBlocks = 0

  for (const ref of refsToReplace) {
    if (totalToolResultTokensAfter <= args.policy.maxToolResultTokens) break

    const sourceMessage = patchedByIndex.get(ref.messageIndex) ?? patchedMessages[ref.messageIndex]
    if (!sourceMessage || !Array.isArray(sourceMessage.content)) continue

    const nextBlocks = [...sourceMessage.content]
    const currentBlock = nextBlocks[ref.blockIndex] as any
    if (!currentBlock || currentBlock.type !== 'tool_result') continue

    const replacementContent = buildToolResultBudgetStub(ref.tool, ref.rawResultText)
    const replacementTokens = estimateTextTokens(replacementContent)
    const savedTokens = Math.max(0, ref.rawTokens - replacementTokens)
    if (savedTokens <= 0) continue

    nextBlocks[ref.blockIndex] = {
      ...currentBlock,
      content: replacementContent,
    }
    const patchedMessage = {
      ...sourceMessage,
      content: nextBlocks as any,
    }
    patchedByIndex.set(ref.messageIndex, patchedMessage)
    patchedMessages[ref.messageIndex] = patchedMessage

    totalToolResultTokensAfter = Math.max(0, totalToolResultTokensAfter - savedTokens)
    estimatedTokensSaved += savedTokens
    replacedBlocks += 1
    if (!replacedToolNameSet.has(ref.tool.name)) {
      replacedToolNameSet.add(ref.tool.name)
      replacedToolNames.push(ref.tool.name)
    }
  }

  return {
    messages: patchedMessages,
    applied: replacedBlocks > 0,
    impact: {
      replacedBlocks,
      replacedToolNames,
      estimatedTokensSaved,
      keptRecentBlocks: Math.max(0, eligibleBlocks.length - replacedBlocks),
      budgetTokens: args.policy.maxToolResultTokens,
      totalToolResultTokensBefore,
      totalToolResultTokensAfter:
        replacedBlocks > 0 ? estimateToolResultGroupTokens(patchedMessages) : totalToolResultTokensBefore,
    },
  }
}

export function estimateToolResultGroupTokens(messages: PromptMessage[]): number {
  let total = 0
  for (const message of messages) {
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_result' || block?.is_error === true) continue
      total += estimateTextTokens(toolResultContentToText(block.content))
    }
  }
  return total
}

function collectToolUsesById(messages: PromptMessage[]): Map<string, ToolUseMeta> {
  const out = new Map<string, ToolUseMeta>()
  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') continue
      out.set(block.id, {
        name: block.name,
        input: isPlainObject(block.input) ? block.input : {},
      })
    }
  }
  return out
}

function collectEligibleToolResults(args: {
  messages: PromptMessage[]
  eligibleToolNames: Set<string>
  minResultChars: number
  minResultCharsByName: Record<string, number>
  toolUsesById: Map<string, ToolUseMeta>
}): EligibleToolResultRef[] {
  const out: EligibleToolResultRef[] = []
  for (let messageIndex = 0; messageIndex < args.messages.length; messageIndex++) {
    const message = args.messages[messageIndex]
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
      const block = message.content[blockIndex] as any
      if (block?.type !== 'tool_result' || block?.is_error === true) continue
      if (typeof block.tool_use_id !== 'string' || block.tool_use_id.length === 0) continue
      if (isDurableToolResultContentReplacement(message, block.tool_use_id)) continue

      const tool = args.toolUsesById.get(block.tool_use_id)
      if (!tool || !args.eligibleToolNames.has(tool.name)) continue

      const rawResultText = toolResultContentToText(block.content)
      if (!rawResultText) continue
      if (isAlreadyToolResultBudgetReplaced(rawResultText)) continue

      const minCharsForTool = Math.max(0, clampCount(args.minResultCharsByName[tool.name], args.minResultChars))
      if (rawResultText.length < minCharsForTool) continue
      if (!isSafeToolResultToReplace(tool, rawResultText)) continue

      out.push({
        messageIndex,
        blockIndex,
        toolUseId: block.tool_use_id,
        tool,
        rawResultText,
        rawTokens: estimateTextTokens(rawResultText),
      })
    }
  }
  return out
}

function buildToolResultBudgetStub(tool: ToolUseMeta, rawResultText: string): string {
  const maxSummaryChars = Math.max(12, DEFAULT_MAX_STUB_CHARS - TOOL_RESULT_BUDGET_STUB_PREFIX.length - 2)
  return `${TOOL_RESULT_BUDGET_STUB_PREFIX} ${clipMiddle(summarizeToolUse(tool, rawResultText), maxSummaryChars)}]`
}

function summarizeToolUse(tool: ToolUseMeta, rawResultText: string): string {
  const name = clipMiddle(tool.name || 'Tool', 24)
  const input = tool.input

  if (tool.name === 'Read') {
    const filePath = readString(input.file_path)
    if (filePath) return `Read ${clipMiddle(filePath, 72)} ${summarizeReadFootprint(rawResultText)}`
    return 'Read result'
  }

  if (tool.name === 'Grep') {
    const pattern = readString(input.pattern)
    const path = readString(input.path)
    const patternPart = pattern ? `Grep ${quoteAndClip(pattern, 48)}` : 'Grep result'
    const base = path ? `${patternPart} in ${clipMiddle(path, 48)}` : patternPart
    return `${base} (${formatCount(countNonEmptyLines(rawResultText))} hits)`
  }

  if (tool.name === 'Glob') {
    const pattern = readString(input.pattern)
    const path = readString(input.path)
    const patternPart = pattern ? `Glob ${quoteAndClip(pattern, 48)}` : 'Glob result'
    const base = path ? `${patternPart} in ${clipMiddle(path, 48)}` : patternPart
    return `${base} (${formatCount(countNonEmptyLines(rawResultText))} paths)`
  }

  if (tool.name === 'Bash') {
    const command = readString(input.command)
    if (command) return `Bash ${quoteAndClip(command, 64)}`
    return 'Bash output'
  }

  if (tool.name === 'WebFetch') {
    const url = readString(input.url)
    if (url) return `WebFetch ${clipMiddle(url, 96)}`
    return 'WebFetch result'
  }

  return `${name} result`
}

function summarizeReadFootprint(rawResultText: string): string {
  const lineCount = countLines(rawResultText)
  if (lineCount > 1) return `(${formatCount(lineCount)} lines)`
  return `(~${formatCount(rawResultText.length)} chars)`
}

function estimateTextTokens(value: string): number {
  const bytes = Buffer.byteLength(value, 'utf8')
  return Math.max(0, Math.ceil(bytes / 4))
}

function countLines(value: string): number {
  if (!value) return 0
  let lines = 1
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

function countNonEmptyLines(value: string): number {
  if (!value.trim()) return 0
  return value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean).length
}

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US')
}

function isSafeToolResultToReplace(tool: ToolUseMeta, rawResultText: string): boolean {
  if (tool.name === 'Bash') return isSafeBashCommand(readString(tool.input.command), rawResultText)
  if (tool.name === 'WebFetch') return isSafeWebFetchUrl(readString(tool.input.url))
  return true
}

function isSafeBashCommand(command: string | null, rawResultText: string): boolean {
  if (!command || !rawResultText.trim()) return false
  const normalized = command.trim().toLowerCase()
  if (BASH_DISALLOWED_PATTERNS.some((pattern) => normalized.includes(pattern))) return false
  return SAFE_BASH_COMMANDS.some((safeCommand) => normalized === safeCommand || normalized.startsWith(`${safeCommand} `))
}

function isSafeWebFetchUrl(url: string | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.search || parsed.hash) return false
    return SAFE_WEBFETCH_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function isAlreadyToolResultBudgetReplaced(value: string): boolean {
  return value.startsWith(TOOL_RESULT_BUDGET_STUB_PREFIX)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function quoteAndClip(value: string, maxChars: number): string {
  return JSON.stringify(clipMiddle(value, maxChars))
}

function clipMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 3) return '.'.repeat(Math.max(1, maxChars))
  const available = Math.max(0, maxChars - 3)
  const keepLeft = Math.ceil(available / 2)
  const keepRight = Math.floor(available / 2)
  return `${value.slice(0, keepLeft)}...${value.slice(value.length - keepRight)}`
}

function clampCount(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value!))
}
