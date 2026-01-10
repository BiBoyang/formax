import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { ReadToolHandler } from './handler'

describe('ReadToolHandler', () => {
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
})
