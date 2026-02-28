import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { ReadToolHandler } from './handler'

describe('ReadToolHandler', () => {
  it('matches tool name with canHandle', () => {
    expect(ReadToolHandler.canHandle('Read')).toBe(true)
    expect(ReadToolHandler.canHandle('Other')).toBe(false)
  })

  it('returns cat -n formatted output', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, ['line1', 'line2', 'line3'].join('\n') + '\n', 'utf8')

    const result = await ReadToolHandler.execute(
      { id: '1', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('     1\tline1\n     2\tline2\n     3\tline3')
    await fsp.unlink(tmpFile)
  })

  it('supports offset/limit with 1-based line numbers', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-offset-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, ['a', 'b', 'c', 'd'].join('\n') + '\n', 'utf8')

    const result = await ReadToolHandler.execute(
      { id: '2', name: 'Read', input: { file_path: tmpFile, offset: 2, limit: 2 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('     2\tb\n     3\tc')
    await fsp.unlink(tmpFile)
  })

  it('returns empty output for an empty file', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-empty-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, '', 'utf8')

    const result = await ReadToolHandler.execute(
      { id: '3', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('')
    await fsp.unlink(tmpFile)
  })

  it('truncates long lines to 2000 characters', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-long-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'a'.repeat(2005), 'utf8')

    const result = await ReadToolHandler.execute(
      { id: '4', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    const parts = result.content.split('\t')
    expect(parts[0]).toBe('     1')
    expect(parts[1]).toBe('a'.repeat(2000))
    await fsp.unlink(tmpFile)
  })

  it('rejects relative file_path', async () => {
    const result = await ReadToolHandler.execute(
      { id: 'rel1', name: 'Read', input: { file_path: 'README.md' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('file_path must be an absolute path')
  })

  it('rejects missing file_path (including missing input fallback)', async () => {
    const noInput = await ReadToolHandler.execute(
      { id: 'missing1', name: 'Read' } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(noInput.is_error).toBe(true)
    expect(noInput.content).toContain('Missing file_path')

    const emptyInput = await ReadToolHandler.execute(
      { id: 'missing2', name: 'Read', input: {} } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(emptyInput.is_error).toBe(true)
    expect(emptyInput.content).toContain('Missing file_path')
  })

  it('rejects directory paths as not-a-file', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-read-dir-'))
    try {
      const result = await ReadToolHandler.execute(
        { id: 'dir1', name: 'Read', input: { file_path: tmpDir } },
        { cwd: process.cwd(), agentDepth: 0 },
      )
      expect(result.is_error).toBe(true)
      expect(result.content).toContain('Not a file:')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('parses string offset/limit values and clamps invalid values', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-string-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, ['a', 'b', 'c', 'd'].join('\n') + '\n', 'utf8')

    const strParsed = await ReadToolHandler.execute(
      { id: 's1', name: 'Read', input: { file_path: tmpFile, offset: ' 3 ', limit: ' 2 ' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(strParsed.is_error).toBeUndefined()
    expect(strParsed.content).toBe('     3\tc\n     4\td')

    const invalid = await ReadToolHandler.execute(
      { id: 's2', name: 'Read', input: { file_path: tmpFile, offset: '   ', limit: 'abc' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(invalid.is_error).toBeUndefined()
    expect(invalid.content).toBe('     1\ta\n     2\tb\n     3\tc\n     4\td')

    await fsp.unlink(tmpFile)
  })

  it('uses process.cwd fallback when ctx.cwd is missing and handles numeric zero offset', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-cwd-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, ['x', 'y'].join('\n') + '\n', 'utf8')

    const result = await ReadToolHandler.execute(
      { id: 'cwd1', name: 'Read', input: { file_path: tmpFile, offset: 0 } },
      { cwd: '' as any, agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('     1\tx\n     2\ty')

    await fsp.unlink(tmpFile)
  })

  it('stringifies non-Error failures in catch', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-throw-${Date.now()}.txt`)
    await fsp.writeFile(tmpFile, 'x\n', 'utf8')

    const spy = vi.spyOn(fsp, 'stat').mockImplementationOnce(async () => {
      throw 'boom'
    })
    const result = await ReadToolHandler.execute(
      { id: 'throw1', name: 'Read', input: { file_path: tmpFile } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: boom')
    spy.mockRestore()
    await fsp.unlink(tmpFile)
  })

  it('formats large line numbers without left padding truncation', async () => {
    const tmpFile = path.join(os.tmpdir(), `formax-read-bigline-${Date.now()}.txt`)
    const lines = Array.from({ length: 100000 }, () => 'z').join('\n') + '\n'
    await fsp.writeFile(tmpFile, lines, 'utf8')

    const result = await ReadToolHandler.execute(
      { id: 'big1', name: 'Read', input: { file_path: tmpFile, offset: 100000, limit: 1 } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('100000\tz')

    await fsp.unlink(tmpFile)
  })
})
