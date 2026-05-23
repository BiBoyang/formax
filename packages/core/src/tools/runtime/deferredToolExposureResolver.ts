import type { PromptBlock } from '../../prompts'
import type { ToolDefinition } from '../types'
import {
  buildAvailableSkillsSystemReminderText,
  buildSkillToolSpecForCwdWithOptions,
} from '../modules/skill'
import { getDeferredToolExposureStore, resolveToolExposureSessionKey } from './deferredToolExposure'

export type DeferredToolExposureResolverArgs = {
  cwd: string
  tools: ToolDefinition[]
  deferredToolExposureEnabled: boolean
  toolSearchEnabled?: boolean
  explicitSessionKey?: string | null
  toolSearchEngine?: string | null
  includeSkillsReminderBlock?: boolean
}

export type DeferredToolExposureResolverResult = {
  baseToolsForTurn: ToolDefinition[]
  toolsForTurn: ToolDefinition[]
  resolveToolsForCall?: () => ToolDefinition[]
  toolExposureSessionKey?: string
  injectedPromptBlocks: PromptBlock[]
}

export function patchToolsForTurnWithSkillDescriptions(args: {
  tools: ToolDefinition[]
  cwd: string
  includeAvailableSkillsInDescription: boolean
}): ToolDefinition[] {
  return args.tools.map((tool) =>
    tool.name === 'Skill'
      ? buildSkillToolSpecForCwdWithOptions(args.cwd, {
          includeAvailableSkillsInDescription: args.includeAvailableSkillsInDescription,
        })
      : tool,
  )
}

function toEphemeralTextBlock(text: string): PromptBlock {
  return {
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  }
}

export function resolveDeferredToolExposureForTurn(
  args: DeferredToolExposureResolverArgs,
): DeferredToolExposureResolverResult {
  const baseToolsForTurn = patchToolsForTurnWithSkillDescriptions({
    tools: args.tools,
    cwd: args.cwd,
    includeAvailableSkillsInDescription: !args.deferredToolExposureEnabled || args.toolSearchEnabled === false,
  })

  if (!args.deferredToolExposureEnabled || args.toolSearchEnabled === false || baseToolsForTurn.length === 0) {
    return {
      baseToolsForTurn,
      toolsForTurn: baseToolsForTurn,
      injectedPromptBlocks: [],
    }
  }

  const sessionKey = resolveToolExposureSessionKey({
    explicitSessionKey: args.explicitSessionKey ?? undefined,
    cwd: args.cwd,
  })
  const store = getDeferredToolExposureStore()
  store.registerCatalog({
    sessionKey,
    tools: baseToolsForTurn,
    toolSearchEngine: args.toolSearchEngine ?? undefined,
  })

  const injectedPromptBlocks: PromptBlock[] = [
    toEphemeralTextBlock(store.buildAvailableDeferredToolsBlock(sessionKey)),
  ]

  if (args.includeSkillsReminderBlock !== false) {
    const reminder = buildAvailableSkillsSystemReminderText(args.cwd)
    if (reminder) injectedPromptBlocks.push(toEphemeralTextBlock(reminder))
  }

  const resolveToolsForCall = () => store.resolveToolsForModel(sessionKey)

  return {
    baseToolsForTurn,
    toolsForTurn: resolveToolsForCall(),
    resolveToolsForCall,
    toolExposureSessionKey: sessionKey,
    injectedPromptBlocks,
  }
}
