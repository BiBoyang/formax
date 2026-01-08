import type { PromptBlock } from './types'

export function buildSystemPrompt(args?: {
  appName?: string
  version?: string
  allowedSubagents?: Array<{ name: string; description: string }>
  cwd?: string
}): PromptBlock[] {
  const base = "You are Claude Code, Anthropic's official CLI for Claude."
  const cwd = args?.cwd?.trim()
  const fsNote =
    (cwd ? `Current working directory: ${cwd}\n\n` : '') +
    'When calling file tools (Read/Write/Edit/...), prefer paths under the current working directory unless the user specifies otherwise. ' +
    'Do not guess other users home directories; if unsure, call Bash(pwd) first.'

  const allowed = args?.allowedSubagents?.filter((a) => a?.name) ?? []
  if (allowed.length === 0) {
    return [
      {
        type: 'text',
        text: `${base}\n\n${fsNote}`,
        cache_control: { type: 'ephemeral' },
      },
    ]
  }

  const list = allowed
    .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ''}`)
    .join('\n')

  return [
    {
      type: 'text',
      text:
        `${base}\n\n${fsNote}\n\n` +
        `Available subagents for Task.subagent_type:\n${list}\n\n` +
        `When calling Task, subagent_type MUST be one of the names above.`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}
