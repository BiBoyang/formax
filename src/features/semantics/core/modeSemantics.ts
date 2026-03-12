import type { PromptBlock } from '../../../prompts/types'
import { buildExitedPlanModeSystemReminder, buildPlanModeSystemReminder } from '../../../shared/utils/planMode'

export type SemanticsMode = 'normal' | 'acceptEdits' | 'plan'

export type SemanticsInjection =
  | {
      kind: 'mode'
      mode: SemanticsMode
      text: string
    }
  | {
      kind: 'exit_plan_mode'
      text: string
    }

export function buildModeSemantics(args: {
  mode: SemanticsMode
  planPath: string | null
  includeExitPlanReminder?: boolean
}): {
  blocks: PromptBlock[]
  injections: SemanticsInjection[]
} {
  const blocks: PromptBlock[] = []
  const injections: SemanticsInjection[] = []

  if (args.mode === 'plan') {
    const text = buildPlanModeSystemReminder(args.planPath)
    blocks.push({
      type: 'text',
      text,
      cache_control: { type: 'ephemeral' },
    })
    injections.push({ kind: 'mode', mode: args.mode, text })
  }

  if (args.includeExitPlanReminder) {
    const text = buildExitedPlanModeSystemReminder(args.planPath)
    blocks.push({
      type: 'text',
      text,
      cache_control: { type: 'ephemeral' },
    })
    injections.push({ kind: 'exit_plan_mode', text })
  }

  return { blocks, injections }
}
