import type { PromptMessage } from '../../prompts'

export type DropOrphanToolBlocksResult = {
  messages: PromptMessage[]
  droppedMessageCount: number
  droppedOrphanToolBlockCount: number
}

export function dropOrphanToolBlocks(messages: PromptMessage[]): DropOrphanToolBlocksResult {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()
  for (const message of messages as Array<PromptMessage | undefined>) {
    if (!message || !Array.isArray(message.content) || message.content.length === 0) continue
    for (const block of message.content as any[]) {
      if (message.role === 'assistant' && block?.type === 'tool_use' && typeof block.id === 'string') {
        toolUseIds.add(block.id)
      }
      if (message.role === 'user' && block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        toolResultIds.add(block.tool_use_id)
      }
    }
  }

  const pairedIds = new Set<string>()
  for (const id of toolUseIds) {
    if (toolResultIds.has(id)) pairedIds.add(id)
  }

  let droppedMessageCount = 0
  let droppedOrphanToolBlockCount = 0
  const out: PromptMessage[] = []
  for (const message of messages as Array<PromptMessage | undefined>) {
    if (!message || !Array.isArray(message.content) || message.content.length === 0) {
      continue
    }

    const hasAnyToolUse =
      message.role === 'assistant' && message.content.some((block: any) => block?.type === 'tool_use')
    const keptToolUseIds =
      message.role === 'assistant'
        ? new Set(
            message.content
              .filter((block: any) => block?.type === 'tool_use' && pairedIds.has(String(block.id)))
              .map((block: any) => String(block.id)),
          )
        : null
    const hasKeptToolUse = Boolean(keptToolUseIds && keptToolUseIds.size > 0)

    const nextContent = message.content.filter((block: any) => {
      if (message.role === 'assistant' && block?.type === 'tool_use') {
        const keep = pairedIds.has(String(block.id))
        if (!keep) droppedOrphanToolBlockCount += 1
        return keep
      }
      if (
        message.role === 'assistant' &&
        (block?.type === 'thinking' || block?.type === 'redacted_thinking')
      ) {
        if (!hasAnyToolUse) return true
        if (hasKeptToolUse) return true
        droppedOrphanToolBlockCount += 1
        return false
      }
      if (message.role === 'user' && block?.type === 'tool_result') {
        const keep = pairedIds.has(String(block.tool_use_id))
        if (!keep) droppedOrphanToolBlockCount += 1
        return keep
      }
      return true
    })

    if (nextContent.length === 0) {
      droppedMessageCount += 1
      continue
    }
    out.push(nextContent.length === message.content.length ? message : { ...message, content: nextContent as any })
  }

  return { messages: out, droppedMessageCount, droppedOrphanToolBlockCount }
}
