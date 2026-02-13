const WEB_SUPPORTED_SLASH_COMMANDS = new Set(['/init', '/clear', '/compact', '/todos'])

export function isWebSupportedCommand(commandName: string): boolean {
  return WEB_SUPPORTED_SLASH_COMMANDS.has(commandName)
}

export function getWebSupportedSlashCommands(): string[] {
  return Array.from(WEB_SUPPORTED_SLASH_COMMANDS)
}
