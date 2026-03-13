import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { TodoWriteToolHandler } from './handler'

describe('TodoWriteToolHandler', () => {
  it('matches only TodoWrite tool name', () => {
    expect(TodoWriteToolHandler.canHandle('TodoWrite')).toBe(true)
    expect(TodoWriteToolHandler.canHandle('Read')).toBe(false)
  })

  it('returns error when todos is not an array', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-not-array.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-1',
        name: 'TodoWrite',
        input: { todos: 'nope' },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos must be an array')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error when input is omitted', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-missing-input.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      { id: 'err-missing-input', name: 'TodoWrite' } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos must be an array')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for invalid todo status', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-bad-status.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-2',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 'done', activeForm: 'Doing A' }],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].status must be one of:')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for empty content', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-empty-content.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-3',
        name: 'TodoWrite',
        input: {
          todos: [{ content: '   ', status: 'pending', activeForm: 'Doing A' }],
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].content must be non-empty')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for non-string content', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-content-type.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-content-type',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 1, status: 'pending', activeForm: 'Doing A' }],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].content must be a string')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for non-string activeForm', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-activeform-type.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-activeform-type',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 'pending', activeForm: 1 }],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].activeForm must be a string')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for empty activeForm', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-activeform-empty.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-activeform-empty',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 'pending', activeForm: '   ' }],
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].activeForm must be non-empty')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error for non-string status', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-status-type.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-status-type',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 1, activeForm: 'Doing A' }],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos[0].status must be a string')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('returns error when todo list exceeds max length', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-too-many.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'err-4',
        name: 'TodoWrite',
        input: {
          todos: Array.from({ length: 101 }, (_, i) => ({
            content: `t${i}`,
            status: 'pending',
            activeForm: `t${i}`,
          })),
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: TodoWrite.input.todos must have at most 100 items')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('writes todos to disk', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: '1',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Do thing', status: 'pending', activeForm: 'Doing thing' },
            { content: 'Finish', status: 'completed', activeForm: 'Finishing' },
          ],
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe(
      'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable',
    )

    const written = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(written.todos).toHaveLength(2)

    await fsp.unlink(tmp)
    delete process.env.FORMAX_TODOS_PATH
  })

  it('accepts multiple in_progress todos', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: '2',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'A', status: 'in_progress', activeForm: 'Doing A' },
            { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
          ],
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe(
      'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable',
    )

    const written = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(written.todos).toHaveLength(2)
    expect(written.todos.map((t: any) => t.status)).toEqual(['in_progress', 'in_progress'])

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('uses process.cwd when ctx.cwd is omitted', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-cwd-fallback.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const result = await TodoWriteToolHandler.execute(
      {
        id: 'cwd-fallback',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 'pending', activeForm: 'Doing A' }],
        },
      },
      { agentDepth: 0 } as any,
    )

    expect(result.is_error).toBeUndefined()
    const written = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(written.todos).toHaveLength(1)

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })

  it('converts non-Error throwables into error text', async () => {
    const tmp = path.join(os.tmpdir(), `formax-todos-${Date.now()}-non-error.json`)
    process.env.FORMAX_TODOS_PATH = tmp

    const input: any = {}
    Object.defineProperty(input, 'todos', {
      get() {
        throw 'boom'
      },
    })
    const result = await TodoWriteToolHandler.execute(
      {
        id: 'non-error',
        name: 'TodoWrite',
        input,
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(String(result.content)).toContain('Error: boom')

    await fsp.rm(tmp, { force: true })
    delete process.env.FORMAX_TODOS_PATH
  })
})
