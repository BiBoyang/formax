import type { PromptBlock } from '../types'

export type OutputStyleId = 'default' | 'explanatory' | 'learning'

export function buildOutputStyleInjectedBlocks(outputStyle: OutputStyleId): PromptBlock[] {
  if (outputStyle === 'explanatory') {
    return [
      {
        type: 'text',
        text:
          '<system-reminder>\n' +
          'Explanatory output style is active. Remember to follow the specific guidelines for this style.\n' +
          '</system-reminder>',
        cache_control: { type: 'ephemeral' },
      },
    ]
  }

  if (outputStyle === 'learning') {
    return [
      {
        type: 'text',
        text:
          '<system-reminder>\n' +
          'Learning output style is active. Remember to follow the specific guidelines for this style.\n' +
          '</system-reminder>',
        cache_control: { type: 'ephemeral' },
      },
    ]
  }

  return []
}

