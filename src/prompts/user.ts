import type { PromptBlock } from './types'

export function buildUserContent(text: string): PromptBlock[] {
  return [{ type: 'text', text }]
}

