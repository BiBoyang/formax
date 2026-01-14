import fs from 'node:fs'
import path from 'node:path'
import type { PromptBlock } from '../../prompts'
import { readTodosCount } from '../../tools/runtime/todosFile'

const MAX_CLAUDE_MD_CHARS = 200_000

export function buildClaudeMdInjectedBlocks(args: { cwd: string }): PromptBlock[] {
  const cwd = args.cwd
  const filePath = path.join(cwd, 'CLAUDE.md')
  if (!fs.existsSync(filePath)) return []

  let contents = ''
  try {
    contents = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const truncated = contents.length > MAX_CLAUDE_MD_CHARS
  if (truncated) contents = contents.slice(0, MAX_CLAUDE_MD_CHARS) + '\n\n(Truncated)\n'

  const text =
    '<system-reminder>\n' +
    "As you answer the user's questions, you can use the following context:\n" +
    '# claudeMd\n' +
    'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
    'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n' +
    `Contents of ${filePath} (project instructions, checked into the codebase):\n\n` +
    contents +
    '\n\n' +
    'IMPORTANT: this context may or may not be relevant to your tasks. ' +
    'You should not respond to this context unless it is highly relevant to your task.\n' +
    '</system-reminder>\n'

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

export function buildTodoInjectedBlocks(args: { cwd: string }): PromptBlock[] {
  const { exists, count } = readTodosCount(args.cwd)
  if (count === null) return []
  if (exists && count > 0) return []

  const text =
    '<system-reminder>\n' +
    'This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. ' +
    'If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. ' +
    'Again do not mention this message to the user.\n' +
    '</system-reminder>'

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

