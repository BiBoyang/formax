import { estimatePromptTokens } from './estimate'
import { buildPromptMessageIdentity, fingerprintPromptMessage, type PromptMessageIdentity } from './compact'
import type { PromptMessage } from '../../prompts'

const DEFAULT_MIN_TEXT_CHARS = 1400
const DEFAULT_KEEP_RECENT_MESSAGES = 2
const DEFAULT_MAX_EXCERPT_CHARS = 160

export const SNIP_STUB_PREFIX = '[Older assistant text snipped for this request:'

export type SnipImpact = {
  snippedMessages: number
  snippedBlocks: number
  estimatedTokensSaved: number
  keptRecentMessages: number
  minTextChars: number
}

export type AdaptiveSnipPolicy = {
  pressureTier: 'inactive' | 'tight' | 'critical'
  enabled: boolean
  keepRecentMessages: number
  minTextChars: number
  maxExcerptChars: number
}

export type RequestSnipRemoval = {
  kind: 'model_facing_index_range'
  startIndex: number
  endIndexExclusive: number
  reason: string
  removedMessageFingerprints: string[]
  removedMessageIdentities?: PromptMessageIdentity[]
}

type EligibleAssistantTextMessageRef = {
  messageIndex: number
  blockCount: number
  rawText: string
}

export function resolveAdaptiveSnipPolicy(args: {
  pressureRatio?: number | null
}): AdaptiveSnipPolicy {
  const ratio = Number.isFinite(args.pressureRatio) ? Math.max(0, args.pressureRatio!) : null
  if (ratio == null || ratio < 0.75) {
    return {
      pressureTier: 'inactive',
      enabled: false,
      keepRecentMessages: DEFAULT_KEEP_RECENT_MESSAGES,
      minTextChars: 1800,
      maxExcerptChars: DEFAULT_MAX_EXCERPT_CHARS,
    }
  }
  if (ratio < 0.9) {
    return {
      pressureTier: 'tight',
      enabled: true,
      keepRecentMessages: 2,
      minTextChars: DEFAULT_MIN_TEXT_CHARS,
      maxExcerptChars: DEFAULT_MAX_EXCERPT_CHARS,
    }
  }
  return {
    pressureTier: 'critical',
    enabled: true,
    keepRecentMessages: 1,
    minTextChars: 1000,
    maxExcerptChars: 120,
  }
}

export function applyRequestSnip(args: {
  messages: PromptMessage[]
  policy: AdaptiveSnipPolicy
}): {
  messages: PromptMessage[]
  applied: boolean
  removals: RequestSnipRemoval[]
  impact: SnipImpact
} {
  const eligibleMessages = collectEligibleAssistantTextMessages({
    messages: args.messages,
    minTextChars: args.policy.minTextChars,
  })
  if (!args.policy.enabled) {
    return {
      messages: args.messages,
      applied: false,
      removals: [],
      impact: {
        snippedMessages: 0,
        snippedBlocks: 0,
        estimatedTokensSaved: 0,
        keptRecentMessages: eligibleMessages.length,
        minTextChars: args.policy.minTextChars,
      },
    }
  }
  if (eligibleMessages.length <= args.policy.keepRecentMessages) {
    return {
      messages: args.messages,
      applied: false,
      removals: [],
      impact: {
        snippedMessages: 0,
        snippedBlocks: 0,
        estimatedTokensSaved: 0,
        keptRecentMessages: eligibleMessages.length,
        minTextChars: args.policy.minTextChars,
      },
    }
  }

  const refsToSnip = eligibleMessages.slice(0, Math.max(0, eligibleMessages.length - args.policy.keepRecentMessages))
  const patchedMessages = [...args.messages]
  let estimatedTokensSaved = 0
  let snippedMessages = 0
  let snippedBlocks = 0
  const removals: RequestSnipRemoval[] = []

  for (const ref of refsToSnip) {
    const sourceMessage = patchedMessages[ref.messageIndex]
    if (!sourceMessage || !Array.isArray(sourceMessage.content)) continue

    const replacement = buildSnipStub(ref.rawText, args.policy.maxExcerptChars)
    const sourceTokens = estimatePromptTokens({ system: [], messages: [sourceMessage] })
    const replacementMessage: PromptMessage = {
      ...sourceMessage,
      content: [{ type: 'text', text: replacement }],
    }
    const replacementTokens = estimatePromptTokens({ system: [], messages: [replacementMessage] })
    if (replacementTokens >= sourceTokens) continue

    patchedMessages[ref.messageIndex] = replacementMessage
    removals.push({
      kind: 'model_facing_index_range',
      startIndex: ref.messageIndex,
      endIndexExclusive: ref.messageIndex + 1,
      reason: 'request snip removed older assistant text message',
      removedMessageFingerprints: [fingerprintPromptMessage(sourceMessage)],
      removedMessageIdentities: [buildPromptMessageIdentity({ message: sourceMessage, index: ref.messageIndex })],
    })
    estimatedTokensSaved += Math.max(0, sourceTokens - replacementTokens)
    snippedMessages += 1
    snippedBlocks += ref.blockCount
  }

  return {
    messages: patchedMessages,
    applied: snippedMessages > 0,
    removals,
    impact: {
      snippedMessages,
      snippedBlocks,
      estimatedTokensSaved,
      keptRecentMessages: Math.max(0, eligibleMessages.length - snippedMessages),
      minTextChars: args.policy.minTextChars,
    },
  }
}

function collectEligibleAssistantTextMessages(args: {
  messages: PromptMessage[]
  minTextChars: number
}): EligibleAssistantTextMessageRef[] {
  const out: EligibleAssistantTextMessageRef[] = []
  for (let messageIndex = 0; messageIndex < args.messages.length; messageIndex++) {
    const message = args.messages[messageIndex]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    if (message.meta?.compactBoundary) continue
    if (message.content.length === 0) continue

    const textBlocks = message.content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string') as Array<{
      type: 'text'
      text: string
    }>
    if (textBlocks.length !== message.content.length || textBlocks.length === 0) continue

    const rawText = textBlocks.map((block) => block.text).join('\n\n').trim()
    if (!rawText) continue
    if (rawText.startsWith(SNIP_STUB_PREFIX)) continue
    if (rawText.length < args.minTextChars) continue

    out.push({
      messageIndex,
      blockCount: textBlocks.length,
      rawText,
    })
  }
  return out
}

function buildSnipStub(text: string, maxExcerptChars: number): string {
  const normalized = normalizeWhitespace(text)
  const excerpt = clipMiddle(normalized, Math.max(48, maxExcerptChars))
  return `${SNIP_STUB_PREFIX} ~${text.length.toLocaleString('en-US')} chars] ${excerpt}`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clipMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const head = Math.max(12, Math.floor((maxChars - 1) / 2))
  const tail = Math.max(12, maxChars - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
