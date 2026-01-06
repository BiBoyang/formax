import type { PromptBlock } from './types'

export function buildSystemPrompt(args?: {
  appName?: string
  version?: string
  allowedSubagents?: Array<{ name: string; description: string }>
}): PromptBlock[] {
  const base = "You are Claude Code, Anthropic's official CLI for Claude."

  const allowed = args?.allowedSubagents?.filter((a) => a?.name) ?? []
  if (allowed.length === 0) {
    return [
      {
        type: 'text',
        text: base,
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
      text: `${base}\n\nAvailable subagents for Task.subagent_type:\n${list}\n\nWhen calling Task, subagent_type MUST be one of the names above.`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

