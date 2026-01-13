import { afterEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createEditToolHandler } from './handler'
import { clearReadLedger } from '../../runtime/readLedger'
import { ReadToolHandler } from '../read/handler'

afterEach(() => {
  clearReadLedger()
})

describe('EditToolHandler', () => {
  it('denies non-plan files in plan mode', async () => {
    const nonPlanPath = path.join(os.tmpdir(), `formax-edit-not-plan-${Date.now()}.txt`)
    await fsp.writeFile(nonPlanPath, 'a', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r0', name: 'Read', input: { file_path: nonPlanPath } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: '1', name: 'Edit', input: { file_path: nonPlanPath, old_string: 'a', new_string: 'b' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode')
    await fsp.unlink(nonPlanPath)
  })

  it('rejects relative file_path without prompting', async () => {
    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: 'rel1', name: 'Edit', input: { file_path: 'x.txt', old_string: 'a', new_string: 'b' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('file_path must be an absolute path')
  })

  it('edits the plan file in plan mode without prompting', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-plan-edit-${Date.now()}.md`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r1', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: 'p1', name: 'Edit', input: { file_path: tmpFile, old_string: 'world', new_string: 'plan' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan', getPlanPath: () => tmpFile },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello plan')
    await fsp.unlink(tmpFile)
  })

  it('edits when approved', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r2', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

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
    await ReadToolHandler.execute(
      { id: 'r3', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

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

  it('fails when old_string is not unique unless replace_all is true', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-nonunique-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'foo\nfoo\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r5', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

    const first = await handler.execute(
      { id: 'nu1', name: 'Edit', input: { file_path: tmpFile, old_string: 'foo', new_string: 'bar' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(first.is_error).toBe(true)
    expect(first.content).toContain('not unique')
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('foo\nfoo\n')

    const second = await handler.execute(
      {
        id: 'nu2',
        name: 'Edit',
        input: { file_path: tmpFile, old_string: 'foo', new_string: 'bar', replace_all: true },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(second.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('bar\nbar\n')
    await fsp.unlink(tmpFile)
  })
})
