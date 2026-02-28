import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createWriteToolHandler } from './handler'
import { clearReadLedger } from '../../runtime/readLedger'
import { ReadToolHandler } from '../read/handler'

afterEach(() => {
  clearReadLedger()
})

describe('WriteToolHandler', () => {
  it('matches tool name with canHandle', () => {
    const handler = createWriteToolHandler()
    expect(handler.canHandle('Write')).toBe(true)
    expect(handler.canHandle('Other')).toBe(false)
  })

  it('denies non-plan files in plan mode', async () => {
    const handler = createWriteToolHandler()

    const tmpFile = path.join(os.tmpdir(), `formax-write-plan-deny-${Date.now()}.txt`)
    const result = await handler.execute(
      { id: '1', name: 'Write', input: { file_path: tmpFile, content: 'hi' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Plan mode')
  })

  it('writes the plan file in plan mode without prompting', async () => {
    const tmpDir = path.join(os.tmpdir(), `formax-plan-${Date.now()}`)
    const planFile = path.join(tmpDir, 'plan.md')
    const handler = createWriteToolHandler()

    const result = await handler.execute(
      { id: 'p1', name: 'Write', input: { file_path: planFile, content: '# Plan' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'plan', getPlanPath: () => planFile },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(planFile, 'utf8')).toBe('# Plan')

    const second = await handler.execute(
      { id: 'p2', name: 'Write', input: { file_path: planFile, content: '# Plan v2' } },
      {
        cwd: '' as any,
        agentDepth: 0,
        replMode: 'normal',
        getReplMode: () => 'plan',
        getPlanPath: () => planFile,
      },
    )
    // Existing files still require a prior Read.
    if (second.is_error) {
      const read = await ReadToolHandler.execute(
        { id: 'p2r', name: 'Read', input: { file_path: planFile } },
        { cwd: process.cwd(), agentDepth: 0 },
      )
      expect(read.is_error).toBeUndefined()
    }
    const secondAfterRead = await handler.execute(
      { id: 'p2b', name: 'Write', input: { file_path: planFile, content: '# Plan v2' } },
      {
        cwd: '' as any,
        agentDepth: 0,
        replMode: 'normal',
        getReplMode: () => 'plan',
        getPlanPath: () => planFile,
      },
    )
    expect(secondAfterRead.is_error).toBeUndefined()
    expect(secondAfterRead.content).toContain('The file has been updated at:')
    expect(await fsp.readFile(planFile, 'utf8')).toBe('# Plan v2')
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes when approved', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-write-${Date.now()}.txt`)
    const handler = createWriteToolHandler()

    const result = await handler.execute(
      { id: '2', name: 'Write', input: { file_path: tmpFile, content: 'hello' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('hello')
    await fsp.unlink(tmpFile)
  })

  it('requires Read before overwriting an existing file', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-write-existing-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'old', 'utf8')

    const handler = createWriteToolHandler()

    const first = await handler.execute(
      { id: '4', name: 'Write', input: { file_path: tmpFile, content: 'new' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(first.is_error).toBe(true)
    expect(first.content).toContain('requires reading the existing file first')
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('old')

    const read = await ReadToolHandler.execute(
      { id: 'r1', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(read.is_error).toBeUndefined()

    const second = await handler.execute(
      { id: '5', name: 'Write', input: { file_path: tmpFile, content: 'new' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(second.is_error).toBeUndefined()
    expect(await fsp.readFile(tmpFile, 'utf8')).toBe('new')
    await fsp.unlink(tmpFile)
  })

  it('stringifies non-Error failures in catch', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-write-throw-${Date.now()}.txt`)
    const handler = createWriteToolHandler()
    const spy = vi.spyOn(fsp, 'mkdir').mockImplementationOnce(async () => {
      throw 'boom'
    })

    const result = await handler.execute(
      { id: 'x1', name: 'Write', input: { file_path: tmpFile, content: 'abc' } },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: boom')
    spy.mockRestore()
  })

  it('validates missing input/content and unexpected keys', async () => {
    const handler = createWriteToolHandler()
    const tmpFile = path.join(os.tmpdir(), `formax-write-validate-${Date.now()}.txt`)

    const missingInput = await handler.execute(
      { id: 'v1', name: 'Write' } as any,
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingInput.is_error).toBe(true)
    expect(missingInput.content).toContain('Missing file_path')

    const missingContent = await handler.execute(
      { id: 'v2', name: 'Write', input: { file_path: tmpFile } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(missingContent.is_error).toBe(true)
    expect(missingContent.content).toContain('Missing content')

    const extra = await handler.execute(
      { id: 'v3', name: 'Write', input: { file_path: tmpFile, content: 'x', extra: 1 } as any },
      { cwd: process.cwd(), agentDepth: 0, replMode: 'normal' },
    )
    expect(extra.is_error).toBe(true)
  })
})
