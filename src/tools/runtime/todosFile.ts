import fs from 'node:fs'
import path from 'node:path'

export function resolveTodosPath(cwd: string): string {
  const envPath = process.env.FORMAX_TODOS_PATH
  if (envPath) return path.resolve(cwd, envPath)

  const logsDir = process.env.FORMAX_LOGS_DIR
    ? path.resolve(cwd, process.env.FORMAX_LOGS_DIR)
    : path.resolve(cwd, 'proxy/logs')

  return path.join(logsDir, 'todos.json')
}

export function readTodosCount(cwd: string): { exists: boolean; count: number | null } {
  const filePath = resolveTodosPath(cwd)
  if (!fs.existsSync(filePath)) return { exists: false, count: 0 }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const todos = (parsed as any)?.todos
    if (!Array.isArray(todos)) return { exists: true, count: 0 }
    return { exists: true, count: todos.length }
  } catch {
    return { exists: true, count: null }
  }
}

