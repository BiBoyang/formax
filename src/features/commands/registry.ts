export type SlashCommandSpec = {
  command: string
  description: string
  implemented?: boolean
}

export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { command: '/tasks', description: 'List and manage background tasks', implemented: true },
  { command: '/plan', description: 'Show current plan', implemented: true },
  {
    command: '/status',
    description: 'Show status including version, model, API connectivity',
    implemented: false,
  },
  { command: '/install-github-app', description: 'Set up GitHub Actions for a repository', implemented: false },
  { command: '/stats', description: 'Show usage statistics and activity', implemented: false },
  { command: '/statusline', description: "Configure Claude Code's status line UI", implemented: false },
  { command: '/ide', description: 'Manage IDE integrations and show status', implemented: false },
  { command: '/cost', description: 'Show total cost and duration of the session', implemented: false },
  { command: '/doctor', description: 'Diagnose and verify installation and settings', implemented: false },
  { command: '/terminal-setup', description: 'Install terminal key bindings and settings', implemented: false },
  { command: '/init', description: 'Initialize a CLAUDE.md file with repo documentation', implemented: true },
]

export function getSlashCommandSuggestions(input: string): SlashCommandSpec[] {
  const raw = (input || '').trimStart()
  if (!raw.startsWith('/')) return []

  const query = raw.slice(1).toLowerCase()
  if (!query) return SLASH_COMMANDS

  return SLASH_COMMANDS.filter((c) => c.command.slice(1).toLowerCase().startsWith(query))
}
