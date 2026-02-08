import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { createGrepToolHandler } from './handler'

describe('createGrepToolHandler', () => {
  it('maps files_with_matches args to rg and returns lines', async () => {
    let capturedArgs: string[] = []
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: '/repo/a.ts\n/repo/b.ts\n',
        stderr: '',
      }
    })
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand,
    })

    const result = await handler.execute(
      {
        id: '1',
        name: 'Grep',
        input: {
          pattern: 'foo',
          path: '.',
          glob: '**/*.ts',
          output_mode: 'files_with_matches',
          '-i': true,
          type: 'ts',
        },
      } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/a.ts\n/repo/b.ts')
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith(
      '/mock/rg',
      expect.arrayContaining([
        '--files-with-matches',
        '--ignore-case',
        '--type',
        'ts',
        '--glob',
        '**/*.ts',
        '--regexp',
        'foo',
        '--',
        path.resolve('/repo', '.'),
      ]),
      { cwd: '/repo' },
    )
    expect(capturedArgs).toContain('--follow')
  })

  it('maps content mode context flags and line-number toggle', async () => {
    let capturedArgs: string[] = []
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: '/repo/a.ts:3:foo\n',
        stderr: '',
      }
    })
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand,
    })

    const result = await handler.execute(
      {
        id: '2',
        name: 'Grep',
        input: {
          pattern: 'foo',
          path: '/repo',
          output_mode: 'content',
          '-C': 2,
          '-n': false,
          multiline: true,
        },
      } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/a.ts:3:foo')
    expect(capturedArgs).toContain('--multiline')
    expect(capturedArgs).toContain('--multiline-dotall')
    expect(capturedArgs).toContain('--before-context')
    expect(capturedArgs).toContain('--after-context')
    expect(capturedArgs).not.toContain('--line-number')
  })

  it('returns No matches found on rg exit code 1', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    })

    const result = await handler.execute(
      { id: '3', name: 'Grep', input: { pattern: 'none' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('No matches found')
  })

  it('keeps partial results when rg exits 2 with stdout', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 2,
        stdout: '/repo/a.ts:1:foo\n/repo/b.ts:2:foo\n',
        stderr: 'permission denied',
      }),
    })

    const result = await handler.execute(
      { id: '4', name: 'Grep', input: { pattern: 'foo', output_mode: 'content', head_limit: 1 } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/a.ts:1:foo')
  })

  it('returns error when rg exits 2 without stdout', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'path not found',
      }),
    })

    const result = await handler.execute(
      { id: '5', name: 'Grep', input: { pattern: 'foo', path: '/missing' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: ripgrep failed')
  })

  it('applies offset/head_limit after rg output', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 0,
        stdout: '/repo/a\n/repo/b\n/repo/c\n',
        stderr: '',
      }),
    })

    const result = await handler.execute(
      { id: '6', name: 'Grep', input: { pattern: 'foo', head_limit: 1, offset: 1 } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/b')
  })

  it('preserves trailing spaces in rg output lines', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 0,
        stdout: '/repo/a.ts:1:foo  \n',
        stderr: '',
      }),
    })

    const result = await handler.execute(
      { id: '7', name: 'Grep', input: { pattern: 'foo', output_mode: 'content' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/a.ts:1:foo  ')
  })
})
