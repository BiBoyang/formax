import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { TodoWriteToolHandler } from './handler'

describe('TodoWriteToolHandler', () => {
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
})
