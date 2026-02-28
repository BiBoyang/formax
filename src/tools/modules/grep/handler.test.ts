import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fsp from 'node:fs/promises'
import { createGrepToolHandler } from './handler'

describe('createGrepToolHandler', () => {
  it('matches tool name with canHandle', () => {
    const handler = createGrepToolHandler()
    expect(handler.canHandle('Grep')).toBe(true)
    expect(handler.canHandle('Other')).toBe(false)
  })

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

  it('parses numeric string options for context, offset and head_limit', async () => {
    let capturedArgs: string[] = []
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async (_command, args) => {
        capturedArgs = args
        return {
          exitCode: 0,
          stdout: '/repo/a.ts:1:foo\n/repo/b.ts:2:foo\n/repo/c.ts:3:foo\n',
          stderr: '',
        }
      },
    })

    const result = await handler.execute(
      {
        id: '2b',
        name: 'Grep',
        input: {
          pattern: 'foo',
          output_mode: 'content',
          '-A': ' 3 ',
          '-B': '2',
          head_limit: '2',
          offset: '1',
        },
      } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/b.ts:2:foo\n/repo/c.ts:3:foo')
    expect(capturedArgs).toContain('--before-context')
    expect(capturedArgs).toContain('--after-context')
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

  it('uses count mode and unknown output_mode falls back to files_with_matches', async () => {
    const seen: string[][] = []
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async (_command, args) => {
        seen.push(args)
        return { exitCode: 0, stdout: 'a\n', stderr: '' }
      },
    })

    const countResult = await handler.execute(
      { id: '8', name: 'Grep', input: { pattern: 'foo', output_mode: 'count' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(countResult.is_error).toBeUndefined()
    expect(seen[0]).toContain('--count')

    const fallbackResult = await handler.execute(
      { id: '9', name: 'Grep', input: { pattern: 'foo', output_mode: 'unknown' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(fallbackResult.is_error).toBeUndefined()
    expect(seen[1]).toContain('--files-with-matches')
  })

  it('returns errors for missing pattern, bad keys, and non-Error throws', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => {
        throw 'boom'
      },
    })

    const missing = await handler.execute(
      { id: '10', name: 'Grep', input: {} } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(missing.is_error).toBe(true)
    expect(missing.content).toContain('Missing pattern')

    const badKey = await handler.execute(
      { id: '11', name: 'Grep', input: { pattern: 'x', extra: 1 } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(badKey.is_error).toBe(true)

    const thrown = await handler.execute(
      { id: '12', name: 'Grep', input: { pattern: 'x' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(thrown.is_error).toBe(true)
    expect(thrown.content).toContain('Error: boom')
  })

  it('uses empty-object fallback when call.input is missing', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })

    const result = await handler.execute(
      { id: '12aa', name: 'Grep' } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing pattern')
  })

  it('uses default cwd fallback when ctx.cwd is missing and supports empty post-window output', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 0,
        stdout: '/repo/a\n/repo/b\n',
        stderr: '',
      }),
    })

    const result = await handler.execute(
      {
        id: '12b',
        name: 'Grep',
        input: { pattern: 'foo', offset: 99 },
      } as any,
      { cwd: '' as any, agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('No matches found')
  })

  it('parses invalid numeric string options as 0', async () => {
    let capturedArgs: string[] = []
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async (_command, args) => {
        capturedArgs = args
        return { exitCode: 0, stdout: '/repo/a\n', stderr: '' }
      },
    })

    const result = await handler.execute(
      {
        id: '12c',
        name: 'Grep',
        input: { pattern: 'foo', output_mode: 'content', '-A': 'abc', '-B': 'xyz' },
      } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
    expect(capturedArgs).not.toContain('--before-context')
    expect(capturedArgs).not.toContain('--after-context')
  })

  it('handles undefined stdout/stderr values from command results', async () => {
    const handler = createGrepToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 2, stdout: undefined as any, stderr: undefined as any }),
    })
    const result = await handler.execute(
      { id: '12d', name: 'Grep', input: { pattern: 'foo' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('unknown error')
  })

  it('uses default spawn runner close path with executable script', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-spawn-'))
    try {
      const script = path.join(tmpDir, 'fake-rg.sh')
      await fsp.writeFile(
        script,
        ['#!/bin/sh', 'echo "x.ts:1:foo"', 'echo "warn-on-stderr" 1>&2', 'exit 0'].join('\n'),
        'utf8',
      )
      await fsp.chmod(script, 0o755)

      const handler = createGrepToolHandler({
        resolveExecutable: async () => script,
      })

      const result = await handler.execute(
        { id: '13', name: 'Grep', input: { pattern: 'foo', output_mode: 'content', path: tmpDir } } as any,
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content).toContain('x.ts:1:foo')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses default spawn runner error path for missing executable', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-spawn-missing-'))
    try {
      const handler = createGrepToolHandler({
        resolveExecutable: async () => path.join(tmpDir, 'missing-rg'),
      })

      const result = await handler.execute(
        { id: '14', name: 'Grep', input: { pattern: 'foo' } } as any,
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('ripgrep failed (-1):')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
