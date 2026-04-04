import type { PromptBlock, PromptMessage } from '../../prompts'
import { getContinuationMessagesAfterLatestCompactBoundary } from './compact'

export function estimatePromptTokens(args: {
  messages: PromptMessage[]
  system: PromptBlock[]
}): number {
  const json = JSON.stringify({
    system: args.system,
    messages: getContinuationMessagesAfterLatestCompactBoundary(args.messages),
  })
  const bytes = Buffer.byteLength(json, 'utf8')
  return Math.max(0, Math.ceil(bytes / 4))
}
