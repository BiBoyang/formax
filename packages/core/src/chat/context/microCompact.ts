import type { PromptMessage } from '../../prompts'
import { toolResultContentToText } from '../../shared/utils/toolResultContent'

const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3
const DEFAULT_MIN_RESULT_CHARS = 1200
const DEFAULT_MAX_STUB_CHARS = 120
export const MICROCOMPACT_STUB_PREFIX = '[Older tool result cleared by microcompact:'
const MICROCOMPACT_COMPANION_STUB_PREFIX = '[Older companion block cleared by microcompact:'
const SKILL_COMPANION_PREFIX = 'Base directory for this skill: '
const DEFAULT_ELIGIBLE_TOOL_NAMES = ['Read', 'Grep', 'Glob', 'Skill'] as const
const DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES = ['Read', 'Grep', 'Glob', 'WebFetch'] as const
const DEFAULT_CACHE_AWARE_MIN_RESULT_CHARS = 400
const DEFAULT_TIME_AWARE_ELIGIBLE_TOOL_NAMES = ['Read', 'Grep', 'Glob'] as const
const DEFAULT_TIME_AWARE_MIN_RESULT_CHARS = 900
const DEFAULT_TIME_AWARE_MIN_STALE_USER_TURNS = 3
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
  staleUserTurns: number
  rawResultChars: number
  rawResultText: string
  compactToolResult: boolean
  compactionReason: 'standard' | 'cache_aware' | 'time_aware' | null
  timeAwareCandidate: boolean
  companionTextBlockIndex?: number
  companionText?: string
}

export type MicroCompactImpact = {
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
  cacheAwareEligibleToolNames: string[]
  cacheAwareMinResultChars: number
  cacheAwareCompactedBlocks: number
  cacheAwareToolNames: string[]
  timeAwareEligibleToolNames: string[]
  timeAwareMinResultChars: number
  timeAwareMinStaleUserTurns: number
  timeAwareCompactedBlocks: number
  timeAwareToolNames: string[]
}

export type AdaptiveMicroCompactPolicy = {
  pressureTier: 'default' | 'relaxed' | 'steady' | 'tight' | 'critical'
  eligibleToolNames: string[]
  cacheAwareEligibleToolNames: string[]
  cacheAwareMinResultChars: number
  timeAwareEligibleToolNames: string[]
  timeAwareMinResultChars: number
  timeAwareMinResultCharsByName: Record<string, number>
  timeAwareMinStaleUserTurns: number
  keepRecentToolResults: number
  keepRecentToolResultsByName: Record<string, number>
  minResultChars: number
  minResultCharsByName: Record<string, number>
}

export function resolveAdaptiveMicroCompactPolicy(args: {
  pressureRatio?: number | null
}): AdaptiveMicroCompactPolicy {
  const ratio = Number.isFinite(args.pressureRatio) ? Math.max(0, args.pressureRatio!) : null
  if (ratio == null) {
    return {
      pressureTier: 'default',
      eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES],
      cacheAwareEligibleToolNames: [...DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES],
      cacheAwareMinResultChars: DEFAULT_CACHE_AWARE_MIN_RESULT_CHARS,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: DEFAULT_TIME_AWARE_MIN_RESULT_CHARS,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: DEFAULT_TIME_AWARE_MIN_STALE_USER_TURNS,
      keepRecentToolResults: DEFAULT_KEEP_RECENT_TOOL_RESULTS,
      keepRecentToolResultsByName: {
        Read: 2,
        Skill: 1,
      },
      minResultChars: DEFAULT_MIN_RESULT_CHARS,
      minResultCharsByName: {},
    }
  }
  if (ratio < 0.5) {
    return {
      pressureTier: 'relaxed',
      eligibleToolNames: ['Read', 'Skill'],
      cacheAwareEligibleToolNames: [...DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES],
      cacheAwareMinResultChars: 600,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 1400,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 4,
      keepRecentToolResults: 4,
      keepRecentToolResultsByName: {
        Read: 2,
        Skill: 2,
      },
      minResultChars: 2400,
      minResultCharsByName: {},
    }
  }
  if (ratio < 0.75) {
    return {
      pressureTier: 'steady',
      eligibleToolNames: ['Read', 'Grep', 'Skill'],
      cacheAwareEligibleToolNames: [...DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES],
      cacheAwareMinResultChars: 500,
      timeAwareEligibleToolNames: [...DEFAULT_TIME_AWARE_ELIGIBLE_TOOL_NAMES],
      timeAwareMinResultChars: 1000,
      timeAwareMinResultCharsByName: {
        Grep: 700,
        Glob: 700,
      },
      timeAwareMinStaleUserTurns: 4,
      keepRecentToolResults: 3,
      keepRecentToolResultsByName: {
        Read: 2,
        Grep: 1,
        Skill: 1,
      },
      minResultChars: 1600,
      minResultCharsByName: {
        Grep: 1000,
      },
    }
  }
  if (ratio < 0.9) {
    return {
      pressureTier: 'tight',
      eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES],
      cacheAwareEligibleToolNames: [...DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES],
      cacheAwareMinResultChars: 400,
      timeAwareEligibleToolNames: [...DEFAULT_TIME_AWARE_ELIGIBLE_TOOL_NAMES],
      timeAwareMinResultChars: 800,
      timeAwareMinResultCharsByName: {
        Grep: 600,
        Glob: 600,
      },
      timeAwareMinStaleUserTurns: 3,
      keepRecentToolResults: 2,
      keepRecentToolResultsByName: {
        Read: 1,
        Skill: 1,
      },
      minResultChars: 1200,
      minResultCharsByName: {
        Grep: 900,
        Glob: 900,
      },
    }
  }
  return {
    pressureTier: 'critical',
    eligibleToolNames: [...DEFAULT_ELIGIBLE_TOOL_NAMES, 'Bash', 'WebFetch'],
    cacheAwareEligibleToolNames: [...DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES],
    cacheAwareMinResultChars: 300,
    timeAwareEligibleToolNames: [...DEFAULT_TIME_AWARE_ELIGIBLE_TOOL_NAMES, 'Bash', 'WebFetch'],
    timeAwareMinResultChars: 600,
    timeAwareMinResultCharsByName: {
      Bash: 900,
      WebFetch: 900,
    },
    timeAwareMinStaleUserTurns: 2,
    keepRecentToolResults: 1,
    keepRecentToolResultsByName: {
      Read: 1,
    },
    minResultChars: 800,
    minResultCharsByName: {
      Grep: 600,
      Glob: 600,
      Bash: 1200,
      WebFetch: 1200,
    },
  }
}

export function microCompactHistory(args: {
  messages: PromptMessage[]
  keepRecentToolResults?: number
  keepRecentToolResultsByName?: Record<string, number>
  minResultChars?: number
  minResultCharsByName?: Record<string, number>
  eligibleToolNames?: Iterable<string>
  cacheAwareEligibleToolNames?: Iterable<string>
  cacheAwareMinResultChars?: number
  timeAwareEligibleToolNames?: Iterable<string>
  timeAwareMinResultChars?: number
  timeAwareMinResultCharsByName?: Record<string, number>
  timeAwareMinStaleUserTurns?: number
}): {
  messages: PromptMessage[]
  compacted: boolean
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
  cacheAwareEligibleToolNames: string[]
  cacheAwareMinResultChars: number
  cacheAwareCompactedBlocks: number
  cacheAwareToolNames: string[]
  timeAwareEligibleToolNames: string[]
  timeAwareMinResultChars: number
  timeAwareMinStaleUserTurns: number
  timeAwareCompactedBlocks: number
  timeAwareToolNames: string[]
} {
  const keepRecentToolResults = clampCount(args.keepRecentToolResults, DEFAULT_KEEP_RECENT_TOOL_RESULTS)
  const keepRecentToolResultsByName = normalizeNamedCountMap(args.keepRecentToolResultsByName)
  const minResultChars = clampCount(args.minResultChars, DEFAULT_MIN_RESULT_CHARS)
  const minResultCharsByName = normalizeNamedCountMap(args.minResultCharsByName)
  const eligibleToolNames = new Set(args.eligibleToolNames ?? DEFAULT_ELIGIBLE_TOOL_NAMES)
  const cacheAwareEligibleToolNames = new Set(args.cacheAwareEligibleToolNames ?? DEFAULT_CACHE_AWARE_ELIGIBLE_TOOL_NAMES)
  const cacheAwareMinResultChars = clampCount(args.cacheAwareMinResultChars, DEFAULT_CACHE_AWARE_MIN_RESULT_CHARS)
  const timeAwareEligibleToolNames = new Set(args.timeAwareEligibleToolNames ?? [])
  const timeAwareMinResultChars = clampCount(args.timeAwareMinResultChars, DEFAULT_TIME_AWARE_MIN_RESULT_CHARS)
  const timeAwareMinResultCharsByName = normalizeNamedCountMap(args.timeAwareMinResultCharsByName)
  const timeAwareMinStaleUserTurns = clampCount(
    args.timeAwareMinStaleUserTurns,
    DEFAULT_TIME_AWARE_MIN_STALE_USER_TURNS,
  )
  const toolUsesById = collectToolUsesById(args.messages)
  const eligibleBlocks = collectEligibleToolResults({
    messages: args.messages,
    eligibleToolNames,
    cacheAwareEligibleToolNames,
    cacheAwareMinResultChars,
    timeAwareEligibleToolNames,
    timeAwareMinResultChars,
    timeAwareMinResultCharsByName,
    timeAwareMinStaleUserTurns,
    minResultChars,
    minResultCharsByName,
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
      cacheAwareEligibleToolNames: [...cacheAwareEligibleToolNames],
      cacheAwareMinResultChars,
      cacheAwareCompactedBlocks: 0,
      cacheAwareToolNames: [],
      timeAwareEligibleToolNames: [...timeAwareEligibleToolNames],
      timeAwareMinResultChars,
      timeAwareMinStaleUserTurns,
      timeAwareCompactedBlocks: 0,
      timeAwareToolNames: [],
    }
  }

  const refsToCompact = selectRefsToCompact({
    eligibleBlocks,
    keepRecentToolResults,
    keepRecentToolResultsByName,
  })
  const patchedMessages = [...args.messages]
  const patchedByIndex = new Map<number, PromptMessage>()
  const compactedToolNames: string[] = []
  const compactedToolNameSet = new Set<string>()
  const cacheAwareToolNames: string[] = []
  const cacheAwareToolNameSet = new Set<string>()
  const timeAwareToolNames: string[] = []
  const timeAwareToolNameSet = new Set<string>()
  let estimatedTokensSaved = 0
  let compactedBlocks = 0
  let cacheAwareCompactedBlocks = 0
  let timeAwareCompactedBlocks = 0

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
    if (ref.compactionReason === 'cache_aware') {
      cacheAwareCompactedBlocks += 1
      if (!cacheAwareToolNameSet.has(ref.tool.name)) {
        cacheAwareToolNameSet.add(ref.tool.name)
        cacheAwareToolNames.push(ref.tool.name)
      }
    }
    if (ref.compactionReason === 'time_aware') {
      timeAwareCompactedBlocks += 1
      if (!timeAwareToolNameSet.has(ref.tool.name)) {
        timeAwareToolNameSet.add(ref.tool.name)
        timeAwareToolNames.push(ref.tool.name)
      }
    }
  }

  return {
    messages: patchedMessages,
    compacted: compactedBlocks > 0,
    compactedBlocks,
    compactedToolNames,
    estimatedTokensSaved,
    keptRecentBlocks: Math.max(0, eligibleBlocks.length - compactedBlocks),
    cacheAwareEligibleToolNames: [...cacheAwareEligibleToolNames],
    cacheAwareMinResultChars,
    cacheAwareCompactedBlocks,
    cacheAwareToolNames,
    timeAwareEligibleToolNames: [...timeAwareEligibleToolNames],
    timeAwareMinResultChars,
    timeAwareMinStaleUserTurns,
    timeAwareCompactedBlocks,
    timeAwareToolNames,
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
  cacheAwareEligibleToolNames: Set<string>
  cacheAwareMinResultChars: number
  timeAwareEligibleToolNames: Set<string>
  timeAwareMinResultChars: number
  timeAwareMinResultCharsByName: Record<string, number>
  timeAwareMinStaleUserTurns: number
  minResultChars: number
  minResultCharsByName: Record<string, number>
  toolUsesById: Map<string, ToolUseMeta>
}): EligibleToolResultRef[] {
  const candidates: EligibleToolResultRef[] = []

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

      const raw = toolResultContentToText(block.content)
      const staleUserTurns = countSubsequentNonToolUserTurns(args.messages, messageIndex)
      if (isAlreadyMicroCompacted(block.content)) continue
      if (!isSafeToolResultToMicroCompact(tool, raw)) continue
      const minCharsForTool = Math.max(
        0,
        clampCount(args.minResultCharsByName[tool.name], args.minResultChars),
      )
      const timeAwareMinCharsForTool = Math.max(
        0,
        clampCount(args.timeAwareMinResultCharsByName[tool.name], args.timeAwareMinResultChars),
      )
      const companion = getEligibleCompanionTextBlock({
        blocks: message.content as any[],
        tool,
        toolResultBlockIndex: blockIndex,
        minChars: minCharsForTool,
      })
      const compactToolResult =
        args.eligibleToolNames.has(tool.name) &&
        raw.length >= minCharsForTool &&
        true
      const cacheAwareCandidate =
        args.cacheAwareEligibleToolNames.has(tool.name) && raw.length >= args.cacheAwareMinResultChars
      const timeAwareCandidate =
        args.timeAwareEligibleToolNames.has(tool.name) &&
        staleUserTurns >= args.timeAwareMinStaleUserTurns &&
        raw.length >= timeAwareMinCharsForTool

      if (!compactToolResult && !companion && !cacheAwareCandidate && !timeAwareCandidate) continue

      candidates.push({
        messageIndex,
        blockIndex,
        toolUseId: block.tool_use_id,
        tool,
        staleUserTurns,
        rawResultChars: raw.length,
        rawResultText: raw,
        compactToolResult,
        compactionReason: compactToolResult ? 'standard' : null,
        timeAwareCandidate,
        companionTextBlockIndex: companion?.blockIndex,
        companionText: companion?.text,
      })
    }
  }

  const duplicateCacheKeys = findCacheAwareDuplicateCacheKeys({
    refs: candidates,
    cacheAwareEligibleToolNames: args.cacheAwareEligibleToolNames,
    cacheAwareMinResultChars: args.cacheAwareMinResultChars,
  })

  return candidates
    .map((ref) => {
      if (ref.compactionReason === 'standard') return ref
      const cacheKey = buildCacheAwareDuplicateCacheKey(ref.tool, ref.rawResultText)
      if (cacheKey && duplicateCacheKeys.has(cacheKey)) {
        return {
          ...ref,
          compactToolResult: true,
          compactionReason: 'cache_aware' as const,
        }
      }
      if (ref.timeAwareCandidate) {
        return {
          ...ref,
          compactToolResult: true,
          compactionReason: 'time_aware' as const,
        }
      }
      return ref
    })
    .filter((ref) => ref.compactToolResult || typeof ref.companionText === 'string')
}

function findCacheAwareDuplicateCacheKeys(args: {
  refs: EligibleToolResultRef[]
  cacheAwareEligibleToolNames: Set<string>
  cacheAwareMinResultChars: number
}): Set<string> {
  const counts = new Map<string, number>()
  for (const ref of args.refs) {
    if (ref.compactionReason === 'standard') continue
    if (!args.cacheAwareEligibleToolNames.has(ref.tool.name)) continue
    if (ref.rawResultChars < args.cacheAwareMinResultChars) continue
    const key = buildCacheAwareDuplicateCacheKey(ref.tool, ref.rawResultText)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([key]) => key))
}

function buildCacheAwareDuplicateCacheKey(tool: ToolUseMeta, rawResultText: string): string | null {
  const lookupKey = buildCacheAwareLookupKey(tool)
  if (!lookupKey) return null
  return `${lookupKey}\u0000${rawResultText}`
}

function buildCacheAwareLookupKey(tool: ToolUseMeta): string | null {
  if (tool.name === 'Read') {
    const filePath = readString(tool.input.file_path)
    return filePath ? `Read:${filePath}` : null
  }
  if (tool.name === 'Grep') {
    const pattern = readString(tool.input.pattern)
    const path = readString(tool.input.path)
    return pattern && path ? `Grep:${pattern}:${path}` : null
  }
  if (tool.name === 'Glob') {
    const pattern = readString(tool.input.pattern)
    const path = readString(tool.input.path)
    return pattern && path ? `Glob:${pattern}:${path}` : null
  }
  if (tool.name === 'WebFetch') {
    const url = readString(tool.input.url)
    return url ? `WebFetch:${url}` : null
  }
  return null
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

function normalizeNamedCountMap(value: Record<string, number> | undefined): Record<string, number> {
  if (!value) return {}
  const out: Record<string, number> = {}
  for (const [key, count] of Object.entries(value)) {
    const normalized = clampCount(count, 0)
    if (normalized > 0) out[key] = normalized
  }
  return out
}

function countSubsequentNonToolUserTurns(messages: PromptMessage[], messageIndex: number): number {
  let count = 0
  for (let i = messageIndex + 1; i < messages.length; i++) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    const content = (message as any).content
    if (!Array.isArray(content)) {
      count += 1
      continue
    }
    const hasToolResult = content.some((block: any) => block?.type === 'tool_result')
    if (!hasToolResult) count += 1
  }
  return count
}

function selectRefsToCompact(args: {
  eligibleBlocks: EligibleToolResultRef[]
  keepRecentToolResults: number
  keepRecentToolResultsByName: Record<string, number>
}): EligibleToolResultRef[] {
  const protectedRefs = new Set<EligibleToolResultRef>()
  const protectedCountByTool = new Map<string, number>()

  for (let i = args.eligibleBlocks.length - 1; i >= 0; i--) {
    const ref = args.eligibleBlocks[i]!
    const allowed = args.keepRecentToolResultsByName[ref.tool.name] ?? 0
    if (allowed <= 0) continue
    const current = protectedCountByTool.get(ref.tool.name) ?? 0
    if (current >= allowed) continue
    protectedRefs.add(ref)
    protectedCountByTool.set(ref.tool.name, current + 1)
  }

  if (protectedRefs.size < args.keepRecentToolResults) {
    for (let i = args.eligibleBlocks.length - 1; i >= 0 && protectedRefs.size < args.keepRecentToolResults; i--) {
      const ref = args.eligibleBlocks[i]!
      if (protectedRefs.has(ref)) continue
      protectedRefs.add(ref)
    }
  }

  return args.eligibleBlocks.filter((ref) => !protectedRefs.has(ref))
}
