import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTodosPath } from '../../tools/runtime/todosFile'
import { buildPostCompactRehydration } from './postCompactRehydration'
import type { PromptMessage } from '../../prompts'

const envKeys = ['FORMAX_TODOS_PATH', 'FORMAX_TODOS_SESSION_ID'] as const
const envSnapshot = new Map<string, string | undefined>()

function readUse(id: string, filePath: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: filePath } }] as any,
  }
}

function readResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'file contents' }] as any,
  }
}

afterEach(() => {
  for (const key of envKeys) {
    const previous = envSnapshot.get(key)
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  envSnapshot.clear()
})

describe('buildPostCompactRehydration', () => {
  it('collects recent files, mode text, plan excerpt, and todo summary', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-rehydrate-'))
    const planPath = path.join(cwd, '.formax', 'plan.md')
    await fs.mkdir(path.dirname(planPath), { recursive: true })
    await fs.writeFile(planPath, 'Investigate auth flow\nPatch compact summary\nVerify diagnostics\nExtra line', 'utf8')

    for (const key of envKeys) envSnapshot.set(key, process.env[key])
    process.env.FORMAX_TODOS_PATH = '.formax/test-todos.json'
    process.env.FORMAX_TODOS_SESSION_ID = 'rehydrate-test-session'
    const todosPath = resolveTodosPath(cwd)
    await fs.mkdir(path.dirname(todosPath), { recursive: true })
    await fs.writeFile(
      todosPath,
      JSON.stringify({ todos: [{ content: 'patch compact flow', status: 'in_progress', activeForm: 'patch compact flow' }] }),
      'utf8',
    )

    const out = buildPostCompactRehydration({
      cwd,
      mode: 'plan',
      planPath,
      previousHistory: [readUse('r1', '/repo/src/auth.ts'), readResult('r1')],
    })

    expect(out.recentFiles).toEqual(['/repo/src/auth.ts'])
    expect(out.modeText).toBe('Current mode: plan')
    expect(out.planPath).toBe(planPath)
    expect(out.planExcerpt).toContain('Investigate auth flow')
    expect(out.todoSummary).toContain('[in_progress] patch compact flow')
    expect(out.hasTodoState).toBe(true)
    expect(out.appliedKinds).toEqual(['recent_files', 'mode_state', 'plan_state', 'todo_state'])
  })
})
