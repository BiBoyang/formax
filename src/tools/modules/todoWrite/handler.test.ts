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
    expect(result.content).toContain('Updated 2 todos')

    const written = JSON.parse(await fsp.readFile(tmp, 'utf8'))
    expect(written.todos).toHaveLength(2)

    await fsp.unlink(tmp)
    delete process.env.FORMAX_TODOS_PATH
  })
})

