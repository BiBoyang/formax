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
  it('canHandle returns true only for Edit', () => {
    const handler = createEditToolHandler()
    expect(handler.canHandle('Edit')).toBe(true)
    expect(handler.canHandle('Write')).toBe(false)
  })

  it('requires the file to be read first before editing', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-unread-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world', 'utf8')
    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: 'unread1', name: 'Edit', input: { file_path: tmpFile, old_string: 'world', new_string: 'plan' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('requires reading the file first')
    await fsp.unlink(tmpFile)
  })

  it('returns old_string not found when no direct/stripped match exists', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-not-found-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'alpha beta\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r-not-found', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: 'nf1', name: 'Edit', input: { file_path: tmpFile, old_string: 'gamma', new_string: 'delta' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('old_string not found in file')
    await fsp.unlink(tmpFile)
  })

  it('validates required edit input fields', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-validate-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r-validate', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    const handler = createEditToolHandler()

    const missingPath = await handler.execute(
      { id: 'v1', name: 'Edit', input: { old_string: 'hello', new_string: 'world' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingPath.is_error).toBe(true)
    expect(missingPath.content).toContain('Missing file_path')

    const missingOld = await handler.execute(
      { id: 'v2', name: 'Edit', input: { file_path: tmpFile, new_string: 'world' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingOld.is_error).toBe(true)
    expect(missingOld.content).toContain('Missing old_string')

    const missingNew = await handler.execute(
      { id: 'v3', name: 'Edit', input: { file_path: tmpFile, old_string: 'hello' } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingNew.is_error).toBe(true)
    expect(missingNew.content).toContain('Missing new_string')

    const sameStrings = await handler.execute(
      { id: 'v4', name: 'Edit', input: { file_path: tmpFile, old_string: 'hello', new_string: 'hello' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(sameStrings.is_error).toBe(true)
    expect(sameStrings.content).toContain('new_string must be different')

    const emptyOld = await handler.execute(
      { id: 'v5', name: 'Edit', input: { file_path: tmpFile, old_string: '', new_string: 'x' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(emptyOld.is_error).toBe(true)
    expect(emptyOld.content).toContain('old_string must not be empty')

    await fsp.unlink(tmpFile)
  })

  it('uses default input/cwd fallbacks and rejects unknown input keys', async () => {
    const handler = createEditToolHandler()

    const missingInput = await handler.execute(
      { id: 'fallback1', name: 'Edit' } as any,
      { agentDepth: 0, replMode: 'normal' } as any,
    )
    expect(missingInput.is_error).toBe(true)
    expect(missingInput.content).toContain('Missing file_path')

    const extraKey = await handler.execute(
      {
        id: 'fallback2',
        name: 'Edit',
        input: { file_path: '/tmp/x', old_string: 'a', new_string: 'b', extra: true },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(extraKey.is_error).toBe(true)
    expect(extraKey.content).toContain('unknown field')
  })

  it('renders numbered snippet when plan edit results in an empty file', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-plan-empty-${Date.now()}.md`)
    await fsp.writeFile(tmpFile, 'remove-me', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r-plan-empty', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    const handler = createEditToolHandler()

    const result = await handler.execute(
      { id: 'pe1', name: 'Edit', input: { file_path: tmpFile, old_string: 'remove-me', new_string: '' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan', getPlanPath: () => tmpFile },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('1→')
    await fsp.unlink(tmpFile)
  })

  it('handles non-Error exceptions from call.input access', async () => {
    const handler = createEditToolHandler()
    const call = { id: 'nonerror', name: 'Edit' } as any
    Object.defineProperty(call, 'input', {
      get() {
        throw 'input-getter-failed'
      },
    })

    const result = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' })
    expect(result.is_error).toBe(true)
    expect(result.content).toBe('Error: input-getter-failed')
  })

  it('handles stripped old_string that becomes empty', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-strip-empty-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r-strip-empty', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    const handler = createEditToolHandler()

    const result = await handler.execute(
      {
        id: 'se1',
        name: 'Edit',
        input: {
          file_path: tmpFile,
          old_string: '     1\t',
          new_string: '     1\treplacement',
        },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('old_string not found in file')
    await fsp.unlink(tmpFile)
  })

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

  it('accepts space-expanded cat -n prefixed old/new strings', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-catn-space-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r3b', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

    const result = await handler.execute(
      {
        id: 'catn2',
        name: 'Edit',
        input: {
          file_path: tmpFile,
          old_string: '     1  hello world',
          new_string: '     1  hello plan',
        },
      },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello plan\n')
    await fsp.unlink(tmpFile)
  })

  it('accepts plan snippet arrow prefixed old/new strings', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-edit-arrow-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'hello world\n', 'utf8')
    await ReadToolHandler.execute(
      { id: 'r4', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    const handler = createEditToolHandler()

    const result = await handler.execute(
      {
        id: 'arrow1',
        name: 'Edit',
        input: {
          file_path: tmpFile,
          old_string: '     1→hello world',
          new_string: '     1→hello plan',
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
