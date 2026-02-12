import type { ReplMode } from '../semantics/replModeTransition'
export type { ReplMode }

export function nextReplMode(mode: ReplMode): ReplMode {
  switch (mode) {
    case 'normal':
      return 'acceptEdits'
    case 'acceptEdits':
      return 'plan'
    case 'plan':
    default:
      return 'normal'
  }
}
