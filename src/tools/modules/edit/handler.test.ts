import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createEditToolHandler } from './handler'

describe('EditToolHandler', () => {
  it('denies in plan mode', async () => {
    const handler = createEditToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '1', name: 'Edit', input: { file_path: 'x.txt', old_string: 'a', new_string: 'b' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode')
  })

  it('edits when approved', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')

    const handler = createEditToolHandler({
      requestAnswers: async () => ({ decision: 'approve' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '2', name: 'Edit', input: { file_path: tmpFile, old_string: 'world', new_string: 'you' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello you')
    await fsp.unlink(tmpFile)
  })

  it('enables acceptEdits for approve_all', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')
    let nextMode: string | null = null

    const handler = createEditToolHandler({
      requestAnswers: async () => ({ decision: 'approve_all' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '3', name: 'Edit', input: { file_path: tmpFile, old_string: 'world', new_string: 'you' } },
      {
        cwd: process.cwd(),
        agentDepth: 0,
        replMode: 'normal',
        setReplMode: (m) => {
          nextMode = m
        },
      },
    )

    expect(result.is_error).toBeUndefined()
    expect(nextMode).toBe('acceptEdits')
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello you')
    await fsp.unlink(tmpFile)
  })
})

