import type { PromptMessage } from '../../prompts'

export function isDurableToolResultContentReplacement(message: PromptMessage, toolUseId: string): boolean {
  const ids = (message.meta as any)?.durableToolResultContentReplacementToolUseIds
  return Array.isArray(ids) && ids.some((value) => value === toolUseId)
}
