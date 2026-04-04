import fs from 'node:fs'
import type { PromptMessage } from '../../prompts'
import { formatTodosForClaude } from '../../prompts/reminders/todos'
import { readTodos } from '../../tools/runtime/todosFile'
import type { CompactRehydrationItemKind } from './compact'
import { collectRecentReadFilesForRehydration } from './compact'

const PLAN_EXCERPT_MAX_LINES = 3
const PLAN_EXCERPT_MAX_CHARS = 280

export type PostCompactRehydration = {
  recentFiles: string[]
  modeText: string | null
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
  hasTodoState: boolean
  appliedKinds: CompactRehydrationItemKind[]
}

export function buildPostCompactRehydration(args: {
  cwd: string
  mode: 'normal' | 'acceptEdits' | 'plan'
  planPath: string | null
  previousHistory: PromptMessage[]
}): PostCompactRehydration {
  const recentFiles = collectRecentReadFilesForRehydration(args.previousHistory)
  const modeText = args.mode === 'normal' ? null : `Current mode: ${args.mode}`
  const planPath = typeof args.planPath === 'string' && args.planPath.trim().length > 0 ? args.planPath.trim() : null
  const planExcerpt = readPlanExcerpt(planPath)
  const todoSummary = readTodoSummary(args.cwd)

  const appliedKinds: CompactRehydrationItemKind[] = []
  if (recentFiles.length > 0) appliedKinds.push('recent_files')
  if (modeText) appliedKinds.push('mode_state')
  if (planPath || planExcerpt) appliedKinds.push('plan_state')
  if (todoSummary) appliedKinds.push('todo_state')

  return {
    recentFiles,
    modeText,
    planPath,
    planExcerpt,
    todoSummary,
    hasTodoState: Boolean(todoSummary),
    appliedKinds,
  }
}

function readPlanExcerpt(planPath: string | null): string | null {
  if (!planPath) return null
  try {
    const raw = fs.readFileSync(planPath, 'utf8')
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, PLAN_EXCERPT_MAX_LINES)
    if (lines.length === 0) return null
    const excerpt = lines.join(' | ')
    return excerpt.length > PLAN_EXCERPT_MAX_CHARS ? `${excerpt.slice(0, PLAN_EXCERPT_MAX_CHARS - 1)}…` : excerpt
  } catch {
    return null
  }
}

function readTodoSummary(cwd: string): string | null {
  const { todos } = readTodos(cwd)
  if (!todos || todos.length === 0) return null
  return formatTodosForClaude(todos, {
    maxItems: 3,
    maxItemChars: 80,
    maxTotalChars: 280,
  })
}
