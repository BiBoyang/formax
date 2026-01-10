import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createEditToolHandler } from './handler'

describe('EditToolHandler', () => {
  it('denies non-plan files in plan mode', async () => {
    const nonPlanPath = path.join(os.tmpdir(), `formax-edit-not-plan-${Date.now()}.txt`)
    const handler = createEditToolHandler({
      requestAnswers: async () => {
        throw new Error('Unexpected prompt')
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: '1', name: 'Edit', input: { file_path: nonPlanPath, old_string: 'a', new_string: 'b' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode')
  })

  it('rejects relative file_path without prompting', async () => {
    let prompted = false
    const handler = createEditToolHandler({
      requestAnswers: async () => {
        prompted = true
        return { decision: 'approve' }
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: 'rel1', name: 'Edit', input: { file_path: 'x.txt', old_string: 'a', new_string: 'b' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(prompted).toBe(false)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('file_path must be an absolute path')
  })

  it('edits the plan file in plan mode without prompting', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-plan-edit-${Date.now()}.md`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')
    let prompted = false

    const handler = createEditToolHandler({
      requestAnswers: async () => {
        prompted = true
        return { decision: 'approve' }
      },
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      { id: 'p1', name: 'Edit', input: { file_path: tmpFile, old_string: 'world', new_string: 'plan' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan', getPlanPath: () => tmpFile },
    )

    expect(prompted).toBe(false)
    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello plan')
    await fsp.unlink(tmpFile)
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

  it('accepts cat -n prefixed old/new strings (from Read output)', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-catn-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world\n', 'utf8')

    const handler = createEditToolHandler({
      requestAnswers: async () => ({ decision: 'approve' }),
      submitAnswers: () => true,
      reject: () => true,
      isPending: () => false,
    })

    const result = await handler.execute(
      {
        id: 'catn1',
        name: 'Edit',
        input: {
          file_path: tmpFile,
          old_string: '     1\thello world',
          new_string: '     1\thello plan',
        },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello plan\n')
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
