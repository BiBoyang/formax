export type WebSupportedSlashCommandSpec = {
  command: string
  description: string
}

const WEB_SUPPORTED_SLASH_COMMAND_SPECS: readonly WebSupportedSlashCommandSpec[] = [
  { command: '/init', description: 'Initialize repository guidance from this project.' },
  { command: '/clear', description: 'Clear the current conversation and start fresh.' },
  { command: '/compact', description: 'Compact context and keep the latest progress.' },
  { command: '/context', description: 'Show current context budget and tool-result diagnostics.' },
  { command: '/todos', description: 'List current task todos and statuses.' },
]

const WEB_SUPPORTED_SLASH_COMMANDS = new Set(
  WEB_SUPPORTED_SLASH_COMMAND_SPECS.map((spec) => spec.command),
)

export function isWebSupportedCommand(commandName: string): boolean {
  return WEB_SUPPORTED_SLASH_COMMANDS.has(commandName)
}

export function getWebSupportedSlashCommands(): string[] {
  return Array.from(WEB_SUPPORTED_SLASH_COMMANDS)
}

export function getWebSupportedSlashCommandSpecs(): WebSupportedSlashCommandSpec[] {
  return WEB_SUPPORTED_SLASH_COMMAND_SPECS.map((spec) => ({ ...spec }))
}
