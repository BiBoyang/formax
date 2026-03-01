import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import type { TodoItem, TodoStatus } from '../../shared/todoContracts'

let cachedTodosSessionId: string | null = null

export function getTodosSessionId(): string {
  if (cachedTodosSessionId) return cachedTodosSessionId

  const fromEnv = process.env.FORMAX_TODOS_SESSION_ID
  const normalized = typeof fromEnv === 'string' ? fromEnv.trim() : ''

  cachedTodosSessionId = normalized || randomUUID()
  return cachedTodosSessionId
}

export function resolveTodosPath(cwd: string): string {
  const envPath = process.env.FORMAX_TODOS_PATH
  if (envPath) return path.resolve(cwd, envPath)

  const sessionId = getTodosSessionId()
  const { globalConfigDir } = getConfigPaths({ cwd, env: process.env })
  const todosDir = path.join(globalConfigDir, 'todos')
  return path.join(todosDir, `${sessionId}-agent-${sessionId}.json`)
}

export type { TodoStatus } from '../../shared/todoContracts'
export type StoredTodo = TodoItem

export function readTodos(cwd: string): { exists: boolean; todos: StoredTodo[] | null } {
  const filePath = resolveTodosPath(cwd)
  if (!fs.existsSync(filePath)) return { exists: false, todos: [] }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const todos = (parsed as any)?.todos
    if (!Array.isArray(todos)) return { exists: true, todos: [] }
    return { exists: true, todos: todos as StoredTodo[] }
  } catch {
    return { exists: true, todos: null }
  }
}

export function readTodosCount(cwd: string): { exists: boolean; count: number | null } {
  const { exists, todos } = readTodos(cwd)
  if (todos === null) return { exists, count: null }
  return { exists, count: todos.length }
}
