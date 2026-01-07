import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  content: string
  status: TodoStatus
  activeForm: string
}

export const TodoWriteToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'TodoWrite'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const todosRaw = (input as any).todos
      if (!Array.isArray(todosRaw)) throw new Error('Missing todos')

      const todos: TodoItem[] = todosRaw.map((t: any) => ({
        content: String(t?.content || ''),
        status: String(t?.status || '') as TodoStatus,
        activeForm: String(t?.activeForm || ''),
      }))

      for (const t of todos) {
        if (!t.content.trim()) throw new Error('Invalid todo: missing content')
        if (!t.activeForm.trim()) throw new Error('Invalid todo: missing activeForm')
        if (!['pending', 'in_progress', 'completed'].includes(t.status)) {
          throw new Error(`Invalid todo status: ${String(t.status)}`)
        }
      }

      const filePath = resolveTodosPath(ctx.cwd || process.cwd())
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, JSON.stringify({ todos }, null, 2) + '\n', 'utf8')

      return { tool_use_id: call.id, content: `Updated ${todos.length} todos` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function resolveTodosPath(cwd: string): string {
  const envPath = process.env.FORMAX_TODOS_PATH
  if (envPath) return path.resolve(cwd, envPath)

  const logsDir = process.env.FORMAX_LOGS_DIR
    ? path.resolve(cwd, process.env.FORMAX_LOGS_DIR)
    : path.resolve(cwd, 'proxy/logs')

  return path.join(logsDir, 'todos.json')
}

