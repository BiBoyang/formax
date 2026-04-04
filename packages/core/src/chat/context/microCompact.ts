import type { PromptMessage } from '../../prompts'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'

const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3
const DEFAULT_MIN_RESULT_CHARS = 1200
const DEFAULT_MAX_STUB_CHARS = 120
export const MICROCOMPACT_STUB_PREFIX = '[Older tool result cleared by microcompact:'
const MICROCOMPACT_COMPANION_STUB_PREFIX = '[Older companion block cleared by microcompact:'
const SKILL_COMPANION_PREFIX = 'Base directory for this skill: '
const DEFAULT_ELIGIBLE_TOOL_NAMES = ['Read', 'Grep', 'Glob', 'Skill'] as const
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
  compactToolResult: boolean
  companionTextBlockIndex?: number
  companionText?: string
}

export type MicroCompactImpact = {
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
}

export type AdaptiveMicroCompactPolicy = {
  pressureTier: 'default' | 'relaxed' | 'steady' | 'tight' | 'critical'
  eligibleToolNames: string[]
  keepRecentToolResults: number
  minResultChars: number
}

export function resolveAdaptiveMicroCompactPolicy(args: {
  pressureRatio?: number | null
}): AdaptiveMicroCompactPolicy {
  const ratio = Number.isFinite(args.pressureRatio) ? Math.max(0, args.pressureRatio!) : null
  if (ratio == null) {
    return {
      pressureTier: 'default',
      eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES],
      keepRecentToolResults: DEFAULT_KEEP_RECENT_TOOL_RESULTS,
      minResultChars: DEFAULT_MIN_RESULT_CHARS,
    }
  }
  if (ratio < 0.5) {
    return {
      pressureTier: 'relaxed',
      eligibleToolNames: ['Read', 'Skill'],
      keepRecentToolResults: 4,
      minResultChars: 2400,
    }
  }
  if (ratio < 0.75) {
    return {
      pressureTier: 'steady',
      eligibleToolNames: ['Read', 'Grep', 'Skill'],
      keepRecentToolResults: 3,
      minResultChars: 1600,
    }
  }
  if (ratio < 0.9) {
    return {
      pressureTier: 'tight',
      eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES],
      keepRecentToolResults: 2,
      minResultChars: 1200,
    }
  }
  return {
    pressureTier: 'critical',
    eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES, 'Bash', 'WebFetch'],
    keepRecentToolResults: 1,
    minResultChars: 800,
  }
}

export function microCompactHistory(args: {
  messages: PromptMessage[]
  keepRecentToolResults?: number
  minResultChars?: number
  eligibleToolNames?: Iterable<string>
}): {
  messages: PromptMessage[]
  compacted: boolean
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
} {
  const keepRecentToolResults = clampCount(args.keepRecentToolResults, DEFAULT_KEEP_RECENT_TOOL_RESULTS)
  const minResultChars = clampCount(args.minResultChars, DEFAULT_MIN_RESULT_CHARS)
  const eligibleToolNames = new Set(args.eligibleToolNames ?? DEFAULT_ELIGIBLE_TOOL_NAMES)
  const toolUsesById = collectToolUsesById(args.messages)
  const eligibleBlocks = collectEligibleToolResults({
    messages: args.messages,
    eligibleToolNames,
    minResultChars,
    toolUsesById,
  })

  if (eligibleBlocks.length <= keepRecentToolResults) {
    return {
      messages: args.messages,
      compacted: false,
      compactedBlocks: 0,
      compactedToolNames: [],
      estimatedTokensSaved: 0,
      keptRecentBlocks: eligibleBlocks.length,
    }
  }

  const refsToCompact = eligibleBlocks.slice(0, eligibleBlocks.length - keepRecentToolResults)
  const patchedMessages = [...args.messages]
  const patchedByIndex = new Map<number, PromptMessage>()
  const compactedToolNames: string[] = []
  const compactedToolNameSet = new Set<string>()
  let estimatedTokensSaved = 0
  let compactedBlocks = 0

  for (const ref of refsToCompact) {
    const sourceMessage = patchedByIndex.get(ref.messageIndex) ?? patchedMessages[ref.messageIndex]
    if (!sourceMessage || !Array.isArray(sourceMessage.content)) continue

    const nextBlocks = [...sourceMessage.content]
    const currentBlock = nextBlocks[ref.blockIndex]
    if (!currentBlock || typeof currentBlock !== 'object') continue
    if ((currentBlock as any).type !== 'tool_result') continue

    if (ref.compactToolResult) {
      const rawResultText = toolResultContentToText((currentBlock as any).content)
      const replacementBlock = {
        ...currentBlock,
        content: buildMicrocompactStub(ref.tool, rawResultText),
      } as any

      nextBlocks[ref.blockIndex] = replacementBlock
      estimatedTokensSaved += Math.max(
        0,
        estimateTextTokens(rawResultText) - estimateTextTokens(toolResultContentToText(replacementBlock.content)),
      )
    }

    if (
      ref.companionTextBlockIndex != null &&
      typeof ref.companionText === 'string' &&
      ref.companionTextBlockIndex > ref.blockIndex &&
      ref.companionTextBlockIndex < nextBlocks.length
    ) {
      const companionBlock = nextBlocks[ref.companionTextBlockIndex] as any
      if (companionBlock?.type === 'text') {
        const replacementText = buildCompanionMicrocompactStub(ref.tool, ref.companionText)
        nextBlocks[ref.companionTextBlockIndex] = {
          ...companionBlock,
          text: replacementText,
        }
        estimatedTokensSaved += Math.max(0, estimateTextTokens(ref.companionText) - estimateTextTokens(replacementText))
      }
    }

    const patchedMessage = {
      ...sourceMessage,
      content: nextBlocks as any,
    }
    patchedByIndex.set(ref.messageIndex, patchedMessage)
    patchedMessages[ref.messageIndex] = patchedMessage

    compactedBlocks += 1
    if (!compactedToolNameSet.has(ref.tool.name)) {
      compactedToolNameSet.add(ref.tool.name)
      compactedToolNames.push(ref.tool.name)
    }
  }

  return {
    messages: patchedMessages,
    compacted: compactedBlocks > 0,
    compactedBlocks,
    compactedToolNames,
    estimatedTokensSaved,
    keptRecentBlocks: Math.max(0, eligibleBlocks.length - compactedBlocks),
  }
}

function estimateTextTokens(value: string): number {
  const bytes = Buffer.byteLength(value, 'utf8')
  return Math.max(0, Math.ceil(bytes / 4))
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
  toolUsesById: Map<string, ToolUseMeta>
}): EligibleToolResultRef[] {
  const out: EligibleToolResultRef[] = []

  for (let messageIndex = 0; messageIndex < args.messages.length; messageIndex++) {
    const message = args.messages[messageIndex]
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue

    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
      const block = message.content[blockIndex] as any
      if (block?.type !== 'tool_result') continue
      if (block?.is_error === true) continue
      if (typeof block.tool_use_id !== 'string' || block.tool_use_id.length === 0) continue

      const tool = args.toolUsesById.get(block.tool_use_id)
      if (!tool) continue
      if (!args.eligibleToolNames.has(tool.name)) continue

      const raw = toolResultContentToText(block.content)
      const companion = getEligibleCompanionTextBlock({
        blocks: message.content as any[],
        tool,
        toolResultBlockIndex: blockIndex,
        minChars: args.minResultChars,
      })
      const compactToolResult =
        raw.length >= args.minResultChars &&
        !isAlreadyMicroCompacted(block.content) &&
        isSafeToolResultToMicroCompact(tool, raw)

      if (!compactToolResult && !companion) continue

      out.push({
        messageIndex,
        blockIndex,
        toolUseId: block.tool_use_id,
        tool,
        compactToolResult,
        companionTextBlockIndex: companion?.blockIndex,
        companionText: companion?.text,
      })
    }
  }

  return out
}

function buildMicrocompactStub(tool: ToolUseMeta, rawResultText: string): string {
  const maxSummaryChars = Math.max(12, DEFAULT_MAX_STUB_CHARS - MICROCOMPACT_STUB_PREFIX.length - 2)
  return `${MICROCOMPACT_STUB_PREFIX} ${clipMiddle(summarizeToolUse(tool, rawResultText), maxSummaryChars)}]`
}

function buildCompanionMicrocompactStub(tool: ToolUseMeta, rawCompanionText: string): string {
  const maxSummaryChars = Math.max(12, DEFAULT_MAX_STUB_CHARS - MICROCOMPACT_COMPANION_STUB_PREFIX.length - 2)
  return `${MICROCOMPACT_COMPANION_STUB_PREFIX} ${clipMiddle(
    summarizeCompanionBlock(tool, rawCompanionText),
    maxSummaryChars,
  )}]`
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

function summarizeCompanionBlock(tool: ToolUseMeta, rawCompanionText: string): string {
  if (tool.name === 'Skill') {
    const skillName = readString(tool.input.skill)
    const label = skillName ? `Skill(${clipMiddle(skillName, 40)}) body` : 'Skill body'
    return `${label} (~${formatCount(rawCompanionText.length)} chars)`
  }

  return `${clipMiddle(tool.name || 'Tool', 24)} companion block`
}

function summarizeReadFootprint(rawResultText: string): string {
  const lineCount = countLines(rawResultText)
  if (lineCount > 1) return `(${formatCount(lineCount)} lines)`
  return `(~${formatCount(rawResultText.length)} chars)`
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

function isSafeToolResultToMicroCompact(tool: ToolUseMeta, rawResultText: string): boolean {
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

function isAlreadyMicroCompacted(content: unknown): boolean {
  return toolResultContentToText(content as any).startsWith(MICROCOMPACT_STUB_PREFIX)
}

function getEligibleCompanionTextBlock(args: {
  blocks: any[]
  tool: ToolUseMeta
  toolResultBlockIndex: number
  minChars: number
}): { blockIndex: number; text: string } | null {
  const candidateIndex = args.toolResultBlockIndex + 1
  if (candidateIndex >= args.blocks.length) return null

  const block = args.blocks[candidateIndex]
  if (block?.type !== 'text' || typeof block.text !== 'string') return null
  if (block.text.length < args.minChars) return null
  if (block.text.startsWith(MICROCOMPACT_COMPANION_STUB_PREFIX)) return null
  if (!isSafeCompanionTextToMicroCompact(args.tool, block.text)) return null

  return { blockIndex: candidateIndex, text: block.text }
}

function isSafeCompanionTextToMicroCompact(tool: ToolUseMeta, text: string): boolean {
  if (tool.name === 'Skill') return text.startsWith(SKILL_COMPANION_PREFIX)
  return false
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
