import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createGlobToolHandler } from './handler'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('createGlobToolHandler', () => {
  it('matches tool name with canHandle', () => {
    const handler = createGlobToolHandler()
    expect(handler.canHandle('Glob')).toBe(true)
    expect(handler.canHandle('Other')).toBe(false)
  })

  it('maps args to rg and returns mtime-sorted absolute paths', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-glob-rg-'))
    try {
      const readme = path.join(tmpDir, 'README.md')
      const dotRules = path.join(tmpDir, '.cursorrules')
      const srcFile = path.join(tmpDir, 'src', 'index.ts')
      await writeFileEnsuringDir(readme, 'root\n')
      await writeFileEnsuringDir(dotRules, 'rules\n')
      await writeFileEnsuringDir(srcFile, 'export {}\n')

      const now = Date.now()
      await fsp.utimes(readme, now / 1000 - 120, now / 1000 - 120)
      await fsp.utimes(dotRules, now / 1000 - 60, now / 1000 - 60)
      await fsp.utimes(srcFile, now / 1000, now / 1000)

      const runCommand = vi.fn(async (_command: string, _args: string[]) => ({
        exitCode: 0,
        stdout: 'README.md\n.cursorrules\nsrc/index.ts\n',
        stderr: '',
      }))
      const handler = createGlobToolHandler({
        resolveExecutable: async () => '/mock/rg',
        runCommand,
      })

      const result = await handler.execute(
        { id: '1', name: 'Glob', input: { pattern: '**/*' } } as any,
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content).toBe([srcFile, dotRules, readme].join('\n'))
      expect(runCommand).toHaveBeenCalledTimes(1)
      expect(runCommand).toHaveBeenCalledWith(
        '/mock/rg',
        expect.arrayContaining([
          '--files',
          '--hidden',
          '--glob',
          '!.git/**',
          '--glob',
          '!node_modules/**',
          '--glob',
          '**/*',
          '.',
        ]),
        { cwd: tmpDir },
      )
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns No files found when rg outputs no matches', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      statPath: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    })

    const result = await handler.execute(
      { id: '2', name: 'Glob', input: { pattern: '**/*.ts' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('No files found')
  })

  it('errors when path is not a directory', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      statPath: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
    })

    const result = await handler.execute(
      { id: '3', name: 'Glob', input: { pattern: '**/*', path: '/repo/file.txt' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('path must be a directory')
  })

  it('returns error when rg exits with a non-match failure code', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 2, stdout: '', stderr: 'permission denied' }),
      statPath: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    })

    const result = await handler.execute(
      { id: '4', name: 'Glob', input: { pattern: '**/*' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: ripgrep failed')
  })

  it('keeps best-effort results when rg exits 2 with stdout', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 2,
        stdout: 'src/a.ts\nsrc/b.ts\n',
        stderr: 'permission denied',
      }),
      statPath: async (filePath: string) => ({
        isDirectory: () => filePath === '/repo',
        mtimeMs: filePath.endsWith('a.ts') ? 100 : 200,
      }),
    })

    const result = await handler.execute(
      { id: '5', name: 'Glob', input: { pattern: '**/*.ts' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/src/b.ts\n/repo/src/a.ts')
  })

  it('uses lexical tie-break for same mtime and keeps absolute stdout paths', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({
        exitCode: 0,
        stdout: '/repo/z.ts\n/repo/a.ts\n',
        stderr: '',
      }),
      statPath: async (filePath: string) => ({
        isDirectory: () => filePath === '/repo',
        mtimeMs: Number.NaN,
      }),
    })

    const result = await handler.execute(
      { id: '6', name: 'Glob', input: { pattern: '**/*.ts', path: '/repo' } } as any,
      { cwd: '/unused', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/a.ts\n/repo/z.ts')
  })

  it('returns error for unexpected exit code and compacts stderr', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 3, stdout: '', stderr: '  one \n two  ' }),
      statPath: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    })

    const result = await handler.execute(
      { id: '7', name: 'Glob', input: { pattern: '**/*' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('ripgrep failed (3): one two')
  })

  it('falls back to mtime=0 when stat for a matched file fails', async () => {
    const handler = createGlobToolHandler({
      resolveExecutable: async () => '/mock/rg',
      runCommand: async () => ({ exitCode: 0, stdout: 'a.ts\nb.ts\n', stderr: '' }),
      statPath: async (filePath: string) => {
        if (filePath === '/repo') return { isDirectory: () => true, mtimeMs: 0 }
        if (filePath.endsWith('a.ts')) throw new Error('missing')
        return { isDirectory: () => false, mtimeMs: 10 }
      },
    })

    const result = await handler.execute(
      { id: '8', name: 'Glob', input: { pattern: '**/*.ts' } } as any,
      { cwd: '/repo', agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('/repo/b.ts\n/repo/a.ts')
  })

  it('uses default spawn runner path (close event) when executable script succeeds', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-glob-spawn-'))
    try {
      const script = path.join(tmpDir, 'fake-rg.sh')
      await writeFileEnsuringDir(
        script,
        ['#!/bin/sh', 'echo "src/ok.ts"', 'echo "warn" 1>&2', 'exit 0'].join('\n'),
      )
      await fsp.chmod(script, 0o755)

      const handler = createGlobToolHandler({
        resolveExecutable: async () => script,
      })

      const result = await handler.execute(
        { id: '9', name: 'Glob', input: { pattern: '**/*.ts', path: tmpDir } } as any,
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content).toContain(path.join(tmpDir, 'src/ok.ts'))
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses default spawn runner error event when executable is missing', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-glob-spawn-missing-'))
    try {
      const handler = createGlobToolHandler({
        resolveExecutable: async () => path.join(tmpDir, 'does-not-exist-rg'),
      })

      const result = await handler.execute(
        { id: '10', name: 'Glob', input: { pattern: '**/*', path: tmpDir } } as any,
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('ripgrep failed (-1):')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
