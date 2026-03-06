import type { PromptBlock, PromptMessage } from '../../prompts'

const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const
const MESSAGE_CACHE_BREAKPOINTS = 2

function clonePromptBlock(block: PromptBlock): PromptBlock {
  if (!block || typeof block !== 'object') return block
  return { ...(block as Record<string, unknown>) } as PromptBlock
}

function normalizeSystemCacheControl(system: PromptBlock[]): PromptBlock[] {
  return system.map((block) => {
    const next = clonePromptBlock(block)
    if ((next as any)?.type !== 'text') return next
    return {
      ...(next as Record<string, unknown>),
      cache_control: EPHEMERAL_CACHE_CONTROL,
    } as PromptBlock
  })
}

function normalizeMessageCacheControl(messages: PromptMessage[]): PromptMessage[] {
  const normalized = messages.map((message) => {
    if (!Array.isArray(message.content) || message.content.length === 0) return message

    const content = message.content.map((block) => {
      const next = clonePromptBlock(block)
      if (!next || typeof next !== 'object') return next

      const record = next as Record<string, unknown>
      const cloned = { ...record }
      if ('cache_control' in cloned) delete cloned.cache_control
      return cloned as PromptBlock
    })

    return { ...message, content }
  })

  const candidateIndexes: number[] = []
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index]
    const content = Array.isArray(message?.content) ? message.content : []
    if (content.length === 0) continue
    candidateIndexes.push(index)
    if (candidateIndexes.length >= MESSAGE_CACHE_BREAKPOINTS) break
  }

  if (candidateIndexes.length === 0) return normalized

  const indexSet = new Set(candidateIndexes)
  return normalized.map((message, messageIndex) => {
    if (!indexSet.has(messageIndex) || !Array.isArray(message.content) || message.content.length === 0) {
      return message
    }
    const lastBlockIndex = message.content.length - 1
    const content = message.content.map((block, blockIndex) => {
      if (blockIndex !== lastBlockIndex) return block
      if (!block || typeof block !== 'object') return block
      return {
        ...(block as Record<string, unknown>),
        cache_control: EPHEMERAL_CACHE_CONTROL,
      } as PromptBlock
    })
    return { ...message, content }
  })
}

export function normalizeAnthropicPromptCachingLayout(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
}): {
  system: PromptBlock[]
  messages: PromptMessage[]
} {
  return {
    system: normalizeSystemCacheControl(args.system),
    messages: normalizeMessageCacheControl(args.messages),
  }
}

