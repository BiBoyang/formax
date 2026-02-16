import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { ReminderService } from './ReminderService'
import { resolveTodosPath } from '../../../tools/runtime/todosFile'

function restoreEnv(
  name: 'FORMAX_TODOS_PATH' | 'FORMAX_CONFIG_DIR' | 'FORMAX_TODOS_SESSION_ID',
  value: string | undefined,
): void {
  if (typeof value === 'string') process.env[name] = value
  else delete process.env[name]
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ReminderService', () => {
  it('injects CLAUDE.md context when present', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nHello\n', 'utf8')
      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'y' }] }, null, 2),
        'utf8',
      )

      const service = new ReminderService()
      const blocks = service.generateInjectedBlocks({ cwd: dir, now: 1 })

      expect(blocks).toHaveLength(1)
      expect((blocks[0] as any).text).toContain('# claudeMd')
      expect((blocks[0] as any).text).toContain('Contents of')
      expect((blocks[0] as any).text).toContain('# CLAUDE.md')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects empty todo reminder every turn while empty', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const service = new ReminderService({ config: { todoEmptyTtlMs: 1000 } })

      const first = service.generateInjectedBlocks({ cwd: dir, now: 0 })
      expect(first).toHaveLength(1)
      expect((first[0] as any).text).toContain('todo list is currently empty')

      const second = service.generateInjectedBlocks({ cwd: dir, now: 500 })
      expect(second).toHaveLength(1)
      expect((second[0] as any).text).toContain('todo list is currently empty')

      const third = service.generateInjectedBlocks({ cwd: dir, now: 1500 })
      expect(third).toHaveLength(1)
      expect((third[0] as any).text).toContain('todo list is currently empty')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not inject stale reminder (handled by tool-loop injection)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const service = new ReminderService({
        config: { todoEmptyTtlMs: Number.POSITIVE_INFINITY, todoUnusedCooldownMs: 0, todoUnusedWithListCooldownMs: 0 },
      })

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, null, 2),
        'utf8',
      )

      const first = service.generateInjectedBlocks({ cwd: dir, now: 0 })
      expect(first).toHaveLength(0)

      service.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      service.recordToolResult({ toolName: 'Task', ok: true, now: 2 })
      service.recordToolResult({ toolName: 'Task', ok: true, now: 3 })

      const unused = service.generateInjectedBlocks({ cwd: dir, now: 4 })
      expect(unused).toHaveLength(1)
      expect((unused[0] as any).text).toContain("The TodoWrite tool hasn't been used recently")
      expect((unused[0] as any).text).not.toContain('Here are the existing contents of your todo list:')

      const unusedWithList = service.generateInjectedBlocks({ cwd: dir, now: 5 })
      expect(unusedWithList).toHaveLength(1)
      expect((unusedWithList[0] as any).text).toContain("The TodoWrite tool hasn't been used recently")
      expect((unusedWithList[0] as any).text).toContain('Here are the existing contents of your todo list:')

      const deduped = service.generateInjectedBlocks({ cwd: dir, now: 6 })
      expect(deduped).toHaveLength(0)

      service.recordToolResult({ toolName: 'TodoWrite', ok: true, now: 7 })
      const afterTodoWrite = service.generateInjectedBlocks({ cwd: dir, now: 8 })
      expect(afterTodoWrite).toHaveLength(0)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects empty todo reminder even when maxRemindersPerSession is 0', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const service = new ReminderService({ config: { maxRemindersPerSession: 0 } })

      const first = service.generateInjectedBlocks({ cwd: dir, now: 0 })
      expect(first).toHaveLength(1)
      expect((first[0] as any).text).toContain('todo list is currently empty')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
