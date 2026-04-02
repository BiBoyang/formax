export type CommandRouting = {
  rawText: string
  commandName: string | null
  commandArgs: string | null
  isSlashCommand: boolean
  isSlashCommandAfterTrim: boolean
  isExactClear: boolean
  isExactCompact: boolean
  shouldUseCommandDispatch: boolean
}

export function resolveCommandRouting(rawText: string): CommandRouting {
  const raw = String(rawText || '')
  const trimmedStart = raw.trimStart()
  const parsed = parseSlashCommand(trimmedStart)
  const commandName = parsed?.commandName ?? null
  const commandArgs = parsed?.commandArgs ?? null
  const isSlashCommand = raw.startsWith('/')
  const isSlashCommandAfterTrim = trimmedStart.startsWith('/')
  const normalized = commandName

  return {
    rawText: raw,
    commandName: normalized,
    commandArgs,
    isSlashCommand,
    isSlashCommandAfterTrim,
    isExactClear: normalized === '/clear',
    isExactCompact: normalized === '/compact',
    shouldUseCommandDispatch:
      normalized === '/init' || normalized === '/compact' || normalized === '/todos' || normalized === '/context',
  }
}

export function isExactSlashCommand(input: string, command: string): boolean {
  const route = resolveCommandRouting(input)
  const normalizedCommand = parseSlashCommand(String(command || '').trim())?.commandName ?? null
  if (!route.isSlashCommandAfterTrim) return false
  if (!normalizedCommand) return false
  return route.commandName === normalizedCommand
}

function parseSlashCommand(input: string): { commandName: string; commandArgs: string } | null {
  if (!input.startsWith('/')) return null
  const firstWhitespace = input.search(/\s/)
  if (firstWhitespace === -1) {
    return {
      commandName: input.toLowerCase(),
      commandArgs: '',
    }
  }

  return {
    commandName: input.slice(0, firstWhitespace).toLowerCase(),
    commandArgs: input.slice(firstWhitespace).trim(),
  }
}
