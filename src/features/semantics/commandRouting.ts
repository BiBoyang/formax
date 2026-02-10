export type CommandRouting = {
  rawText: string
  commandName: string | null
  isSlashCommand: boolean
  isSlashCommandAfterTrim: boolean
  isExactClear: boolean
  isExactCompact: boolean
  shouldUseCommandDispatch: boolean
}

export function resolveCommandRouting(rawText: string): CommandRouting {
  const raw = String(rawText || '')
  const trimmedStart = raw.trimStart()
  const commandName = parseSlashCommandName(trimmedStart)
  const isSlashCommand = raw.startsWith('/')
  const isSlashCommandAfterTrim = trimmedStart.startsWith('/')
  const normalized = commandName?.toLowerCase() ?? null

  return {
    rawText: raw,
    commandName: normalized,
    isSlashCommand,
    isSlashCommandAfterTrim,
    isExactClear: normalized === '/clear',
    isExactCompact: normalized === '/compact',
    shouldUseCommandDispatch: normalized === '/init',
  }
}

export function isExactSlashCommand(input: string, command: string): boolean {
  const route = resolveCommandRouting(input)
  const normalizedCommand = parseSlashCommandName(String(command || '').trim())
  if (!route.isSlashCommandAfterTrim) return false
  if (!normalizedCommand) return false
  return route.commandName === normalizedCommand
}

function parseSlashCommandName(input: string): string | null {
  if (!input.startsWith('/')) return null
  const [head] = input.split(/\s+/, 1)
  return head ? head.toLowerCase() : null
}
