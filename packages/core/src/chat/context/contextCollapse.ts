import type { PromptMessage } from '../../prompts'
import { estimatePromptTokens } from './estimate'
import {
  collectRecentReadFilesForRehydration,
  findLatestCompactBoundaryIndex,
  fingerprintPromptMessage,
  getContinuationMessagesAfterLatestCompactBoundary,
  isCompactionSummaryUserMessage,
  sanitizeReminderText,
  type CompactBoundaryKeepStrategy,
} from './compact'

const DEFAULT_CONTEXT_COLLAPSE_KEEP_STRATEGY: CompactBoundaryKeepStrategy = {
  kind: 'keep_last_turns',
  keepLastTurns: 2,
}
const DEFAULT_MIN_HEAD_TOKENS = 1200
const DEFAULT_MIN_SAVED_TOKENS = 200
const DEFAULT_RECENT_USER_PROMPTS = 2
const DEFAULT_RECENT_FILES = 3
export const CONTEXT_COLLAPSE_PREFIX = 'Older continuation collapsed for this request only.'

export type ContextCollapseResult = {
  messages: PromptMessage[]
  collapsed: boolean
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  metadata: ContextCollapseMeta | null
}

export type ContextCollapseMeta = {
  schemaVersion: 1
  kind: 'request_recap'
  keepLastTurns: number
  preservedTailMessageCount: number
  retainedCompactSummary: boolean
  recentUserPromptCount: number
  recentFileCount: number
  earlierToolResultBlockCount: number
  recapFingerprint: string
}

export function collapseRequestHistory(args: {
  messages: PromptMessage[]
  keepStrategy?: CompactBoundaryKeepStrategy
  minHeadTokens?: number
  minSavedTokens?: number
  allowBoundarylessContinuation?: boolean
}): ContextCollapseResult {
  const latestCompactBoundaryIndex = findLatestCompactBoundaryIndex(args.messages)
  if (latestCompactBoundaryIndex < 0 && !args.allowBoundarylessContinuation) {
    return {
      messages: args.messages,
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    }
  }

  const continuation =
    latestCompactBoundaryIndex >= 0 ? getContinuationMessagesAfterLatestCompactBoundary(args.messages) : args.messages
  if (continuation.length < 4) {
    return {
      messages: args.messages,
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    }
  }

  const keepLastTurns = resolveCollapseKeepLastTurns(args.keepStrategy ?? DEFAULT_CONTEXT_COLLAPSE_KEEP_STRATEGY)
  const preservedTail = selectCollapseTail(continuation, keepLastTurns)
  if (preservedTail.length === 0 || preservedTail.length >= continuation.length) {
    return {
      messages: args.messages,
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    }
  }

  const collapsedHead = continuation.slice(0, continuation.length - preservedTail.length)
  const headTokens = estimatePromptTokens({ system: [], messages: collapsedHead })
  if (headTokens < (args.minHeadTokens ?? DEFAULT_MIN_HEAD_TOKENS)) {
    return {
      messages: args.messages,
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    }
  }

  const toolResultBlocks = countToolResultBlocks(collapsedHead)
  const recapParts = buildContextCollapseRecapMessage(collapsedHead)
  const recapMessage = recapParts.message
  const recapTokens = estimatePromptTokens({ system: [], messages: [recapMessage] })
  const estimatedTokensSaved = Math.max(0, headTokens - recapTokens)
  if (estimatedTokensSaved < (args.minSavedTokens ?? DEFAULT_MIN_SAVED_TOKENS)) {
    return {
      messages: args.messages,
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    }
  }

  return {
    messages: [recapMessage, ...preservedTail],
    collapsed: true,
    collapsedHeadMessageCount: collapsedHead.length,
    estimatedTokensSaved,
    metadata: {
      schemaVersion: 1,
      kind: 'request_recap',
      keepLastTurns,
      preservedTailMessageCount: preservedTail.length,
      retainedCompactSummary: recapParts.retainedCompactSummary,
      recentUserPromptCount: recapParts.recentUserPromptCount,
      recentFileCount: recapParts.recentFileCount,
      earlierToolResultBlockCount: toolResultBlocks,
      recapFingerprint: fingerprintPromptMessage(recapMessage),
    },
  }
}

function buildContextCollapseRecapMessage(messages: PromptMessage[]): {
  message: PromptMessage
  retainedCompactSummary: boolean
  recentUserPromptCount: number
  recentFileCount: number
} {
  const compactSummaryExcerpt = extractCompactionSummaryExcerpt(messages)
  const recentUserPrompts = collectRecentUserPrompts(messages, DEFAULT_RECENT_USER_PROMPTS)
  const recentFiles = collectRecentReadFilesForRehydration(messages, DEFAULT_RECENT_FILES)
  const toolResultBlocks = countToolResultBlocks(messages)
  const lines = [CONTEXT_COLLAPSE_PREFIX, `Earlier messages collapsed: ${messages.length}`]

  if (compactSummaryExcerpt) {
    lines.push('Earlier compact summary to retain:')
    lines.push(truncateForReminder(sanitizeReminderText(compactSummaryExcerpt), 240))
  }

  if (toolResultBlocks > 0) {
    lines.push(`Earlier tool-result blocks: ${toolResultBlocks}`)
  }

  if (recentUserPrompts.length > 0) {
    lines.push('Earlier user requests to keep in mind:')
    for (const prompt of recentUserPrompts) {
      lines.push(`- ${truncateForReminder(sanitizeReminderText(prompt), 180)}`)
    }
  }

  if (recentFiles.length > 0) {
    lines.push('Earlier working-set files:')
    for (const filePath of recentFiles) {
      lines.push(`- ${truncateForReminder(sanitizeReminderText(filePath), 200)}`)
    }
  }

  return {
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<system-reminder>\n${lines.join('\n')}\n</system-reminder>`,
        },
      ] as any,
    },
    retainedCompactSummary: Boolean(compactSummaryExcerpt),
    recentUserPromptCount: recentUserPrompts.length,
    recentFileCount: recentFiles.length,
  }
}

function selectCollapseTail(messages: PromptMessage[], keepLastTurns: number): PromptMessage[] {
  if (messages.length === 0) return []
  const userTurnIndices = findLastNonToolUserIndices(messages)
  if (userTurnIndices.length === 0) return []
  const clampedTurns = Math.max(1, Math.floor(keepLastTurns))
  const startUserIndex = userTurnIndices[Math.max(0, userTurnIndices.length - clampedTurns)] as number
  return messages.slice(startUserIndex)
}

function findLastNonToolUserIndices(messages: PromptMessage[]): number[] {
  const out: number[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (!Array.isArray(message.content)) continue
    if (isCompactionSummaryUserMessage(message)) continue
    if (message.content.some((block: any) => block?.type === 'tool_result')) continue
    out.push(index)
  }
  return out
}

function resolveCollapseKeepLastTurns(strategy: CompactBoundaryKeepStrategy): number {
  return Math.max(1, Math.floor(strategy.keepLastTurns))
}

function collectRecentUserPrompts(messages: PromptMessage[], limit: number): string[] {
  const keep = Math.max(0, Math.floor(limit))
  if (keep <= 0) return []

  const prompts: string[] = []
  for (let index = messages.length - 1; index >= 0 && prompts.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (isCompactionSummaryUserMessage(message)) continue
    if (!Array.isArray(message.content)) continue
    if (message.content.some((block: any) => block?.type === 'tool_result')) continue

    const text = extractLeadingText(message)
    if (!text) continue
    prompts.push(text)
  }

  return prompts
}

function extractCompactionSummaryExcerpt(messages: PromptMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !isCompactionSummaryUserMessage(message)) continue
    const text = extractLeadingText(message)
    if (text) return text
  }
  return null
}

function countToolResultBlocks(messages: PromptMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type === 'tool_result') count += 1
    }
  }
  return count
}

function extractLeadingText(message: PromptMessage): string {
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type !== 'text' || typeof (block as any).text !== 'string') continue
    const unwrapped = unwrapSystemReminder(String((block as any).text))
    if (unwrapped) return unwrapped
  }
  return ''
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  return String(match ? match[1] ?? '' : raw).trim()
}

function truncateForReminder(value: string, maxChars: number): string {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  if (!Number.isFinite(maxChars) || maxChars <= 1 || normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}
