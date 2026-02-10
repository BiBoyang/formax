import { buildInitPrompt } from '../../prompts/init'

export type SlashResolution = {
  raw: string
  resolved: 'pass_through' | 'model_mapped' | 'local_only'
  modelUserText: string
  commandName: string | null
}

function parseCommandName(rawText: string): string | null {
  const trimmed = rawText.trim()
  if (!trimmed.startsWith('/')) return null
  const [head] = trimmed.split(/\s+/, 1)
  return head ? head.toLowerCase() : null
}

export function resolveSlashSemantics(rawText: string): SlashResolution {
  const commandName = parseCommandName(rawText)
  if (commandName === '/init') {
    return {
      raw: rawText,
      resolved: 'model_mapped',
      modelUserText: buildInitPrompt(),
      commandName,
    }
  }

  return {
    raw: rawText,
    resolved: 'pass_through',
    modelUserText: rawText,
    commandName,
  }
}
