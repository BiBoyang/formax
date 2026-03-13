import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { ReminderService } from './ReminderService'
import { InMemoryReminderStateStore } from './ReminderStateStore'
import { resolveTodosPath } from '../../../tools/runtime/todosFile'
import { buildAutoMemoryDirectoryPath } from '../../../shared/utils/autoMemoryPath'

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
      const blocks = service.generateInjectedBlocks({ cwd: dir, now: 1, includeAutoMemory: true })

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

  it('injects MEMORY.md content through the claudeMd reminder block', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'y' }] }, null, 2),
        'utf8',
      )

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: dir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), '# User Memory\n- prefer fp\n', 'utf8')

      const service = new ReminderService()
      const blocks = service.generateInjectedBlocks({ cwd: dir, now: 1 })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('# claudeMd')
      expect(text).toContain("user's auto-memory, persists across conversations")
      expect(text).toContain('# User Memory')
      expect(text).toContain('- prefer fp')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not inject MEMORY.md when includeAutoMemory is false', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'y' }] }, null, 2),
        'utf8',
      )

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: dir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), '# User Memory\n- hidden\n', 'utf8')

      const service = new ReminderService()
      const blocks = service.generateInjectedBlocks({ cwd: dir, now: 1, includeAutoMemory: false })
      expect(blocks).toEqual([])
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

  it('stops emitting non-empty todo reminders after hitting session cap', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, null, 2),
        'utf8',
      )

      const service = new ReminderService({
        config: {
          maxRemindersPerSession: 1,
          todoUnusedAfterToolUses: 1,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
          todoUnusedWithListAfterReminders: 99,
        },
      })

      service.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      const first = service.generateInjectedBlocks({ cwd: dir, now: 2 })
      const second = service.generateInjectedBlocks({ cwd: dir, now: 3 })

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(0)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('suppresses repeated short reminders during cooldown', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, null, 2),
        'utf8',
      )

      const service = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedCooldownMs: 10_000,
          todoUnusedWithListCooldownMs: 10_000,
          todoUnusedWithListAfterReminders: 99,
        },
      })

      service.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      const first = service.generateInjectedBlocks({ cwd: dir, now: 2 })
      const second = service.generateInjectedBlocks({ cwd: dir, now: 3 })

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(0)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns no non-empty reminders when session cap is zero and list-body cannot be built', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: '', status: 'pending', activeForm: '' }] }, null, 2),
        'utf8',
      )

      const capped = new ReminderService({
        config: {
          maxRemindersPerSession: 0,
          todoUnusedAfterToolUses: 1,
        },
      })
      capped.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      expect(capped.generateInjectedBlocks({ cwd: dir, now: 2 })).toHaveLength(0)

      const listOnly = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedWithListAfterReminders: 0,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
        },
      })
      listOnly.recordToolResult({ toolName: 'Task', ok: true, now: 3 })
      expect(listOnly.generateInjectedBlocks({ cwd: dir, now: 4 })).toHaveLength(0)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('dedupes same-text reminders and tracks latest reminder across multiple list reminders', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'a', status: 'pending', activeForm: 'a' }] }, null, 2),
        'utf8',
      )

      const shortOnly = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedWithListAfterReminders: 99,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
        },
      })
      shortOnly.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      expect(shortOnly.generateInjectedBlocks({ cwd: dir, now: 2 })).toHaveLength(1)
      expect(shortOnly.generateInjectedBlocks({ cwd: dir, now: 3 })).toHaveLength(0)

      const listOnly = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedWithListAfterReminders: 0,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
        },
      })
      listOnly.recordToolResult({ toolName: 'Task', ok: true, now: 10 })
      expect(listOnly.generateInjectedBlocks({ cwd: dir, now: 11 })).toHaveLength(1)

      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'b', status: 'pending', activeForm: 'b' }] }, null, 2),
        'utf8',
      )
      expect(listOnly.generateInjectedBlocks({ cwd: dir, now: 12 })).toHaveLength(1)

      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'c', status: 'pending', activeForm: 'c' }] }, null, 2),
        'utf8',
      )
      expect(listOnly.generateInjectedBlocks({ cwd: dir, now: 13 })).toHaveLength(1)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns no reminder when todos file is malformed', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(todosPath, '{bad-json', 'utf8')

      const service = new ReminderService()
      const blocks = service.generateInjectedBlocks({ cwd: dir })
      expect(blocks).toEqual([])
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not reset reminder state when TodoWrite fails', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, null, 2),
        'utf8',
      )

      const service = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
          todoUnusedWithListAfterReminders: 99,
        },
      })

      // Use default now for one call to cover Date.now() branch.
      service.recordToolResult({ toolName: 'Task', ok: true })
      const first = service.generateInjectedBlocks({ cwd: dir, now: 2 })
      expect(first).toHaveLength(1)

      service.recordToolResult({ toolName: 'TodoWrite', ok: false, now: 3 })
      const second = service.generateInjectedBlocks({ cwd: dir, now: 4 })
      expect(second).toHaveLength(0)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps unrelated reminder keys when clearing TodoWrite reminder prefixes', () => {
    const store = new InMemoryReminderStateStore({
      remindersSentAt: {
        todo_unused_short_1: 1,
        todo_unused_list_1: 2,
        custom_other_1: 3,
      },
      remindersSentText: {
        todo_unused_short_1: 'a',
        todo_unused_list_1: 'b',
        custom_other_1: 'c',
      },
    })
    const service = new ReminderService({ store })
    service.recordToolResult({ toolName: 'TodoWrite', ok: true, now: 4 })

    const state = store.get()
    expect(state.remindersSentAt).toEqual({ custom_other_1: 3 })
    expect(state.remindersSentText).toEqual({ custom_other_1: 'c' })
  })

  it('handles equal-timestamp reminder history when selecting latest prefix entry', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', dir)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'one', status: 'pending', activeForm: 'one' }] }, null, 2),
        'utf8',
      )

      const service = new ReminderService({
        config: {
          maxRemindersPerSession: 10,
          todoUnusedAfterToolUses: 1,
          todoUnusedWithListAfterReminders: 0,
          todoUnusedCooldownMs: 0,
          todoUnusedWithListCooldownMs: 0,
        },
      })

      service.recordToolResult({ toolName: 'Task', ok: true, now: 1 })
      expect(service.generateInjectedBlocks({ cwd: dir, now: 10 })).toHaveLength(1)

      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'two', status: 'pending', activeForm: 'two' }] }, null, 2),
        'utf8',
      )
      expect(service.generateInjectedBlocks({ cwd: dir, now: 10 })).toHaveLength(1)

      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'three', status: 'pending', activeForm: 'three' }] }, null, 2),
        'utf8',
      )
      expect(service.generateInjectedBlocks({ cwd: dir, now: 11 })).toHaveLength(1)
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
