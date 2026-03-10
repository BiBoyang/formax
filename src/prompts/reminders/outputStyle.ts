import { makeSystemReminderBlock } from '../authoring'
import type { PromptBlock } from '../types'

export type OutputStyleId = 'default' | 'explanatory' | 'learning'

export function buildOutputStyleInjectedBlocks(outputStyle: OutputStyleId): PromptBlock[] {
  if (outputStyle === 'explanatory') {
    return [
      makeSystemReminderBlock(
        'Explanatory output style is active. Remember to follow the specific guidelines for this style.',
      ),
    ]
  }

  if (outputStyle === 'learning') {
    return [
      makeSystemReminderBlock(
        'Learning output style is active. Remember to follow the specific guidelines for this style.',
      ),
    ]
  }

  return []
}
