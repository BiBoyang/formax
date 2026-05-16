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
  const adjacencyNormalized = normalizeToolResultAdjacency(messages)
  const normalized = adjacencyNormalized.map((message) => {
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

function getToolUseIds(message: PromptMessage): string[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return []
  const ids: string[] = []
  for (const block of message.content as any[]) {
    if (block?.type === 'tool_use' && typeof block.id === 'string' && block.id.length > 0) {
      ids.push(block.id)
    }
  }
  return ids
}

function hasToolResultBlock(message: PromptMessage | undefined): boolean {
  if (!message || message.role !== 'user' || !Array.isArray(message.content)) return false
  return message.content.some((block: any) => block?.type === 'tool_result')
}

export function normalizeToolResultAdjacency(messages: PromptMessage[]): PromptMessage[] {
  const normalized: PromptMessage[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue

    normalized.push(message)

    const toolUseIds = getToolUseIds(message)
    if (toolUseIds.length === 0) continue

    const toolUseIdSet = new Set(toolUseIds)
    const toolResultsById = new Map<string, PromptBlock>()
    const extraToolResults: PromptBlock[] = []
    const trailingBlocks: PromptBlock[] = []
    let scan = index + 1
    let consumed = 0

    while (scan < messages.length && hasToolResultBlock(messages[scan])) {
      const candidate = messages[scan]!
      consumed += 1

      for (const block of candidate.content) {
        if ((block as any)?.type !== 'tool_result') {
          trailingBlocks.push(block)
          continue
        }

        const toolUseId = String((block as any)?.tool_use_id ?? '')
        if (toolUseIdSet.has(toolUseId) && !toolResultsById.has(toolUseId)) {
          toolResultsById.set(toolUseId, block)
        } else {
          extraToolResults.push(block)
        }
      }

      scan += 1
      if (toolUseIds.every((id) => toolResultsById.has(id))) break
    }

    if (consumed === 0) continue
    if (!toolUseIds.every((id) => toolResultsById.has(id))) continue

    const orderedToolResults = toolUseIds.map((id) => toolResultsById.get(id)!)
    normalized.push({
      role: 'user',
      content: [...orderedToolResults, ...extraToolResults, ...trailingBlocks],
    })
    index += consumed
  }

  return normalized
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
