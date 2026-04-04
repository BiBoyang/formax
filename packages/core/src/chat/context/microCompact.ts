import type { PromptMessage } from '../../prompts'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'

const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3
const DEFAULT_MIN_RESULT_CHARS = 1200
const DEFAULT_MAX_STUB_CHARS = 120
export const MICROCOMPACT_STUB_PREFIX = '[Older tool result cleared by microcompact:'
const DEFAULT_ELIGIBLE_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob'])

type ToolUseMeta = {
  name: string
  input: Record<string, unknown>
}

type EligibleToolResultRef = {
  messageIndex: number
  blockIndex: number
  toolUseId: string
  tool: ToolUseMeta
}

export type MicroCompactImpact = {
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
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

    const replacementBlock = {
      ...currentBlock,
      content: buildMicrocompactStub(ref.tool),
    } as any

    nextBlocks[ref.blockIndex] = replacementBlock

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
    estimatedTokensSaved += Math.max(
      0,
      estimateTextTokens(toolResultContentToText((currentBlock as any).content)) -
        estimateTextTokens(toolResultContentToText(replacementBlock.content)),
    )
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
      if (isAlreadyMicroCompacted(block.content)) continue

      const tool = args.toolUsesById.get(block.tool_use_id)
      if (!tool) continue
      if (!args.eligibleToolNames.has(tool.name)) continue

      const raw = toolResultContentToText(block.content)
      if (raw.length < args.minResultChars) continue

      out.push({
        messageIndex,
        blockIndex,
        toolUseId: block.tool_use_id,
        tool,
      })
    }
  }

  return out
}

function buildMicrocompactStub(tool: ToolUseMeta): string {
  const maxSummaryChars = Math.max(12, DEFAULT_MAX_STUB_CHARS - MICROCOMPACT_STUB_PREFIX.length - 2)
  return `${MICROCOMPACT_STUB_PREFIX} ${clipMiddle(summarizeToolUse(tool), maxSummaryChars)}]`
}

function summarizeToolUse(tool: ToolUseMeta): string {
  const name = clipMiddle(tool.name || 'Tool', 24)
  const input = tool.input

  if (tool.name === 'Read') {
    const filePath = readString(input.file_path)
    if (filePath) return `Read ${clipMiddle(filePath, 96)}`
    return 'Read result'
  }

  if (tool.name === 'Grep') {
    const pattern = readString(input.pattern)
    const path = readString(input.path)
    const patternPart = pattern ? `Grep ${quoteAndClip(pattern, 48)}` : 'Grep result'
    return path ? `${patternPart} in ${clipMiddle(path, 72)}` : patternPart
  }

  if (tool.name === 'Glob') {
    const pattern = readString(input.pattern)
    const path = readString(input.path)
    const patternPart = pattern ? `Glob ${quoteAndClip(pattern, 48)}` : 'Glob result'
    return path ? `${patternPart} in ${clipMiddle(path, 72)}` : patternPart
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

function isAlreadyMicroCompacted(content: unknown): boolean {
  return toolResultContentToText(content as any).startsWith(MICROCOMPACT_STUB_PREFIX)
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
