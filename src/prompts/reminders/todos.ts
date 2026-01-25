export const TODO_EMPTY_REMINDER_BODY =
  'This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. ' +
  'If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. ' +
  'Again do not mention this message to the user.'

export const TODO_UNUSED_REMINDER_PREFIX =
  "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. " +
  "Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. " +
  'This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user'

export const TODO_UNUSED_REMINDER_BODY = TODO_UNUSED_REMINDER_PREFIX

export type TodoLike = { content?: unknown; status?: unknown; activeForm?: unknown }

export type TodoTrimConfig = {
  maxItems: number
  maxItemChars: number
  maxTotalChars: number
}

const DEFAULT_TODO_TRIM: TodoTrimConfig = {
  maxItems: 3,
  maxItemChars: 80,
  maxTotalChars: 800,
}

export function buildTodoUnusedReminderBody(): string {
  return TODO_UNUSED_REMINDER_BODY
}

export function buildTodoUnusedWithListReminderBody(
  todos: TodoLike[],
  config?: Partial<TodoTrimConfig>,
): string | null {
  const formatted = formatTodosForClaude(todos, config)
  if (!formatted) return null

  return (
    `${TODO_UNUSED_REMINDER_PREFIX}\n\n` +
    'Here are the existing contents of your todo list:\n\n' +
    formatted
  )
}

export function formatTodosForClaude(todos: TodoLike[], config?: Partial<TodoTrimConfig>): string | null {
  const trim = { ...DEFAULT_TODO_TRIM, ...(config ?? {}) }
  const maxItems = Math.max(0, Math.floor(trim.maxItems))
  const maxItemChars = Math.max(0, Math.floor(trim.maxItemChars))
  const maxTotalChars = Math.max(0, Math.floor(trim.maxTotalChars))

  const lines: string[] = []
  for (let i = 0; i < todos.length; i++) {
    const raw = todos[i]
    const content = typeof raw?.content === 'string' ? raw.content.trim() : ''
    const status = typeof raw?.status === 'string' ? raw.status.trim() : ''
    if (!content) continue
    if (!status) continue
    lines.push(`${lines.length + 1}. [${status}] ${content}`)
    if (maxItems > 0 && lines.length >= maxItems) break
  }

  if (lines.length === 0) return null

  const clipped =
    maxItemChars > 0 ? lines.map((l) => (l.length > maxItemChars ? l.slice(0, maxItemChars - 1) + '…' : l)) : lines

  const reduced: string[] = [...clipped]
  if (maxTotalChars > 0) {
    while (reduced.length > 1 && `[${reduced.join('\n')}]`.length > maxTotalChars) reduced.pop()
    const joined = `[${reduced.join('\n')}]`
    if (joined.length > maxTotalChars) return joined.slice(0, maxTotalChars - 1) + '…'
  }

  return `[${reduced.join('\n')}]`
}
