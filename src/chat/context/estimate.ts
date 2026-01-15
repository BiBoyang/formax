import type { PromptBlock, PromptMessage } from '../../prompts'

export function estimatePromptTokens(args: {
  messages: PromptMessage[]
  system: PromptBlock[]
}): number {
  const json = JSON.stringify({ system: args.system, messages: args.messages })
  const bytes = Buffer.byteLength(json, 'utf8')
  return Math.max(0, Math.ceil(bytes / 4))
}

