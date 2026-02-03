import type { PromptBlock } from '../../prompts'

export type UiMessage = {
  id?: string
  role: 'assistant' | 'system'
  content: string
  ui?: {
    kind: 'command_subline'
  }
  timestamp?: Date
}

export type OverlaySpec =
  | { kind: 'agents' }
  | { kind: 'permissions' }
  | { kind: 'hooks' }
  | { kind: 'config' }
  | { kind: 'resume' }
  | { kind: 'custom'; id: string; props?: Record<string, unknown> }

export type UiEffect =
  | { type: 'appendMessages'; messages: UiMessage[] }
  | { type: 'openOverlay'; overlay: OverlaySpec }
  | { type: 'closeOverlay' }
  | { type: 'toast'; kind: 'info' | 'warning' | 'error'; message: string }

export type ModelEffect = { type: 'injectNextTurn'; blocks: PromptBlock[] }

export type CommandResult =
  | { consumed: false }
  | {
      consumed: true
      ui?: UiEffect[]
      model?: ModelEffect[]
      data?: unknown
    }

export function isConsumedCommandResult(result: CommandResult): result is Extract<CommandResult, { consumed: true }> {
  return result.consumed
}

export function consumedCommandResult(args?: {
  ui?: UiEffect[]
  model?: ModelEffect[]
  data?: unknown
}): Extract<CommandResult, { consumed: true }> {
  return { consumed: true, ...args }
}
