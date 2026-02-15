import type { PromptBlock } from '../../prompts'
import { consumedCommandResult, type CommandResult, type UiEffect } from './contracts'
import type { LocalCommandRecord, SlashCommandEffect } from './registry'
import { buildLocalCommandInjectedBlocks } from '../repl/injectedBlocks'

export type SlashCommandResultData =
  | {
      kind: 'llm'
      blocks: PromptBlock[]
      loadingText?: string
    }
  | {
      kind: 'local_async'
      loadingText?: string
      run: () => Promise<{ stdout: string; recordForNextTurn?: LocalCommandRecord }>
    }

export type SlashCommandCommandResult = Extract<CommandResult, { consumed: true; data?: unknown }> & {
  data?: SlashCommandResultData
}

function appendAssistantMessage(content: string): UiEffect {
  return { type: 'appendMessages', messages: [{ role: 'assistant', content }] }
}

function appendCommandSublines(stdout: string): UiEffect {
  const lines = String(stdout ?? '').split('\n')
  const now = Date.now()
  const timestamp = new Date()
  return {
    type: 'appendMessages',
    messages: lines.map((content, idx) => ({
      id: `assistant-${now}-${idx}`,
      role: 'assistant',
      ui: { kind: 'command_subline' as const },
      content,
      timestamp,
    })),
  }
}

export function slashEffectToCommandResult(effect: SlashCommandEffect | null): CommandResult {
  if (!effect) return { consumed: false }

  switch (effect.kind) {
    case 'open_agents_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'agents' } }] })

    case 'open_permissions_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'permissions' } }] })

    case 'open_hooks_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'hooks' } }] })

    case 'open_config_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'config' } }] })

    case 'open_resume_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'resume' } }] })

    case 'open_model_dialog':
      return consumedCommandResult({ ui: [{ type: 'openOverlay', overlay: { kind: 'model' } }] })

    case 'local':
      // Render local slash command output as "sub lines" (⎿ ...) under the user command.
      // Model injection remains controlled by recordForNextTurn (currently only /todos sets it).
      return consumedCommandResult({
        ui: [appendCommandSublines(effect.stdout)],
        model: effect.recordForNextTurn
          ? [{ type: 'injectNextTurn', blocks: buildLocalCommandInjectedBlocks(effect.recordForNextTurn) }]
          : undefined,
      })

    case 'unimplemented':
      return consumedCommandResult({ ui: [appendAssistantMessage(effect.message)] })

    case 'local_async':
      return consumedCommandResult({
        ui: [appendCommandSublines(`${effect.loadingText || 'Working'}...`)],
        data: { kind: 'local_async', loadingText: effect.loadingText, run: effect.run },
      })

    case 'llm':
      return consumedCommandResult({
        data: { kind: 'llm', blocks: effect.blocks, loadingText: effect.loadingText },
      })
  }
}

export function isSlashCommandResultData(data: unknown): data is SlashCommandResultData {
  if (!data || typeof data !== 'object') return false
  const d = data as { kind?: unknown }
  return d.kind === 'llm' || d.kind === 'local_async'
}
