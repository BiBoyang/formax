import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { buildClaudeMdInjectedBlocks, buildTodoInjectedBlocks } from './injectedBlocks'

describe('repl injected blocks', () => {
  it('injects CLAUDE.md context when present', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nHello\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({ cwd: dir })
      expect(blocks).toHaveLength(1)
      expect((blocks[0] as any).text).toContain('# claudeMd')
      expect((blocks[0] as any).text).toContain('Contents of')
      expect((blocks[0] as any).text).toContain('# CLAUDE.md')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects empty todo reminder when todos file missing', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    process.env.FORMAX_TODOS_PATH = 'todos.json'
    try {
      const blocks = buildTodoInjectedBlocks({ cwd: dir })
      expect(blocks).toHaveLength(1)
      expect((blocks[0] as any).text).toContain('todo list is currently empty')
      expect((blocks[0] as any).text).toContain('TodoWrite')
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not inject todo reminder when todos exist', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    process.env.FORMAX_TODOS_PATH = 'todos.json'
    try {
      await fsp.writeFile(
        path.join(dir, 'todos.json'),
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'y' }] }, null, 2),
        'utf8',
      )

      const blocks = buildTodoInjectedBlocks({ cwd: dir })
      expect(blocks).toHaveLength(0)
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

