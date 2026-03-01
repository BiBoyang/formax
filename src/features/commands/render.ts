import type { PromptBlock } from '../../prompts'

export function buildFileCommandContent(args: {
  command: string
  args: string
  body: string
}): PromptBlock[] {
  const cmdName = args.command.startsWith('/') ? args.command.slice(1) : args.command
  const cmdArgs = args.args || ''
  return [
    {
      type: 'text',
      text:
        `<command-message>${cmdName} is running…</command-message>\n` +
        `<command-name>${args.command}</command-name>` +
        (cmdArgs ? `\n<command-args>${cmdArgs}</command-args>` : ''),
    },
    {
      type: 'text',
      text: args.body,
    },
  ]
}

export function buildFileCommandExpandedText(args: {
  command: string
  args: string
  body: string
}): string {
  const blocks = buildFileCommandContent(args)
  return blocks
    .map((b) => {
      const text = (b as any).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n\n')
}
