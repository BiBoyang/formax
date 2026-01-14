export const TODO_EMPTY_REMINDER_BODY =
  'This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. ' +
  'If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. ' +
  'Again do not mention this message to the user.'

export const TODO_STALE_REMINDER_PREFIX =
  "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. " +
  "Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. " +
  'This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user'

export type TodoLike = { content?: unknown; status?: unknown }

export function buildTodoStaleReminderBody(todos: TodoLike[]): string | null {
  const formatted = formatTodosForClaude(todos)
  if (!formatted) return null

  return (
    `${TODO_STALE_REMINDER_PREFIX}\n\n\n` +
    'Here are the existing contents of your todo list:\n\n' +
    `${formatted}`
  )
}

export function formatTodosForClaude(todos: TodoLike[]): string | null {
  const lines: string[] = []
  for (let i = 0; i < todos.length; i++) {
    const raw = todos[i]
    const content = typeof raw?.content === 'string' ? raw.content.trim() : ''
    const status = typeof raw?.status === 'string' ? raw.status.trim() : ''
    if (!content) continue
    if (!status) continue
    lines.push(`${i + 1}. [${status}] ${content}`)
  }

  if (lines.length === 0) return null
  return `[${lines.join('\n')}]`
}

