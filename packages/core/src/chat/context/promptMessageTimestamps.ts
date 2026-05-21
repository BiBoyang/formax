import type { PromptMessage } from '../../prompts'

export function stampMissingAssistantMessageTimestamps(
  messages: PromptMessage[],
  timestampIso: string,
): PromptMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    if (typeof message.meta?.timestamp === 'string' && message.meta.timestamp.trim()) return message
    changed = true
    return {
      ...message,
      meta: {
        ...(message.meta ?? {}),
        timestamp: timestampIso,
      },
    }
  })
  return changed ? next : messages
}

export function readPromptMessageTimestampMs(message: PromptMessage | null | undefined): number | null {
  const raw = typeof message?.meta?.timestamp === 'string' ? message.meta.timestamp : ''
  if (!raw.trim()) return null
  const value = new Date(raw).getTime()
  return Number.isFinite(value) ? value : null
}
