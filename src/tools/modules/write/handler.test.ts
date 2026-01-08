import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createWriteToolHandler } from './handler'

describe('WriteToolHandler', () => {
  it('denies in plan mode', async () => {
    const handler = createWriteToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '1', name: 'Write', input: { file_path: 'x.txt', content: 'hi' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode')
  })

  it('writes when approved', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-write-${Date.now()}.txt`)
    const handler = createWriteToolHandler({
      requestAnswers: async () => ({ decision: 'approve' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '2', name: 'Write', input: { file_path: tmpFile, content: 'hello' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello')
    await fsp.unlink(tmpFile)
  })

  it('enables acceptEdits for approve_all', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-write-${Date.now()}.txt`)
    let nextMode: string | null = null

    const handler = createWriteToolHandler({
      requestAnswers: async () => ({ decision: 'approve_all' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '3', name: 'Write', input: { file_path: tmpFile, content: 'hello' } },
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
    await fsp.unlink(tmpFile)
  })
})

