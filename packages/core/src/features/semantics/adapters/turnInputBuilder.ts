import { buildUserContent, type PromptBlock } from '@formax/shared/prompts'
import { buildModeSemantics, type SemanticsInjection, type SemanticsMode } from '../core/modeSemantics'
import { resolveSlashSemantics } from '../core/slashSemantics'

export function buildTurnInput(args: {
  rawText: string
  mode: SemanticsMode
  planPath: string | null
  includeExitPlanReminder?: boolean
  slashLlmBlocks?: PromptBlock[] | null
}): {
  displayText: string
  modelUserText: string
  semanticBlocks: PromptBlock[]
  userBlocks: PromptBlock[]
  injections: SemanticsInjection[]
  slash: {
    raw: string
    resolved: 'pass_through' | 'model_mapped' | 'local_only'
    commandName: string | null
  }
} {
  const displayText = args.rawText
  const slash = resolveSlashSemantics(args.rawText)
  const modelUserText = slash.modelUserText
  const modeSemantics = buildModeSemantics({
    mode: args.mode,
    planPath: args.planPath,
    includeExitPlanReminder: args.includeExitPlanReminder,
  })

  const userBlocks =
    Array.isArray(args.slashLlmBlocks) && args.slashLlmBlocks.length > 0
      ? args.slashLlmBlocks
      : buildUserContent(modelUserText)

  return {
    displayText,
    modelUserText,
    semanticBlocks: modeSemantics.blocks,
    userBlocks,
    injections: modeSemantics.injections,
    slash: {
      raw: slash.raw,
      resolved: slash.resolved,
      commandName: slash.commandName,
    },
  }
}
