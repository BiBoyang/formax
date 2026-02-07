import type { SlashCommandSpec } from '../../features/commands/registry'

export function createSlashCommandSpecMap(specs: SlashCommandSpec[]): Map<string, SlashCommandSpec> {
  const map = new Map<string, SlashCommandSpec>()
  for (const spec of specs) {
    const key = spec.command.toLowerCase()
    if (!map.has(key)) map.set(key, spec)
  }
  return map
}

export function resolveSlashCommandInputHint(args: {
  input: string
  slashSpecByCommand: Map<string, SlashCommandSpec>
}): string | null {
  const raw = String(args.input || '').trimStart()
  if (!raw.startsWith('/')) return null

  const firstWhitespaceIndex = raw.search(/\s/)
  const commandToken = firstWhitespaceIndex >= 0 ? raw.slice(0, firstWhitespaceIndex) : raw
  const trailing = firstWhitespaceIndex >= 0 ? raw.slice(firstWhitespaceIndex) : ''
  if (!commandToken) return null
  if (trailing.trim().length > 0) return null

  const spec = args.slashSpecByCommand.get(commandToken.toLowerCase())
  if (!spec?.argHint) return null

  const hasTrailingWhitespace = trailing.length > 0
  return hasTrailingWhitespace ? spec.argHint : ` ${spec.argHint}`
}
