import type { PromptBlock } from '../../../prompts'
import type { ChatHistory } from './types'

function stripEphemeralBlocks(blocks: PromptBlock[]): PromptBlock[] {
  return blocks.filter((b) => (b as any)?.cache_control?.type !== 'ephemeral')
}

export function stripEphemeralFromHistory(history: ChatHistory): ChatHistory {
  return history.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg
    const content = (msg as any).content
    if (!Array.isArray(content)) return msg
    return { ...msg, content: stripEphemeralBlocks(content) } as typeof msg
  })
}
