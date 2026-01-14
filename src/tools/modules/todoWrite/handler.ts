import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { resolveTodosPath } from '../../runtime/todosFile'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  content: string
  status: TodoStatus
  activeForm: string
}

const MAX_TODOS = 100
const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

const RESULT_FOR_ASSISTANT =
  'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable'

export const TodoWriteToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'TodoWrite'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = requirePlainObject(call.input || {}, 'TodoWrite.input')
      assertNoExtraKeys(input, ['todos'], 'TodoWrite.input')
      const todosRaw = (input as any).todos
      if (!Array.isArray(todosRaw)) throw new Error('TodoWrite.input.todos must be an array')
      if (todosRaw.length > MAX_TODOS) throw new Error(`TodoWrite.input.todos must have at most ${MAX_TODOS} items`)

      const todos: TodoItem[] = todosRaw.map((value: unknown, index: number) => {
        const todo = requirePlainObject(value, `TodoWrite.input.todos[${index}]`)
        assertNoExtraKeys(todo, ['content', 'status', 'activeForm'], `TodoWrite.input.todos[${index}]`)

        const content = todo.content
        if (typeof content !== 'string') {
          throw new Error(`TodoWrite.input.todos[${index}].content must be a string`)
        }
        if (!content.trim()) throw new Error(`TodoWrite.input.todos[${index}].content must be non-empty`)

        const activeForm = todo.activeForm
        if (typeof activeForm !== 'string') {
          throw new Error(`TodoWrite.input.todos[${index}].activeForm must be a string`)
        }
        if (!activeForm.trim()) throw new Error(`TodoWrite.input.todos[${index}].activeForm must be non-empty`)

        const status = todo.status
        if (typeof status !== 'string') {
          throw new Error(`TodoWrite.input.todos[${index}].status must be a string`)
        }
        if (!TODO_STATUSES.includes(status as TodoStatus)) {
          throw new Error(`TodoWrite.input.todos[${index}].status must be one of: ${TODO_STATUSES.join(', ')}`)
        }

        return { content, status: status as TodoStatus, activeForm }
      })

      const filePath = resolveTodosPath(ctx.cwd || process.cwd())
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, JSON.stringify({ todos }, null, 2) + '\n', 'utf8')

      return { tool_use_id: call.id, content: RESULT_FOR_ASSISTANT }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}
