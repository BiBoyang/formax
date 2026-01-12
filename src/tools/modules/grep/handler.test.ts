import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GrepToolHandler } from './handler'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('GrepToolHandler', () => {
  it('defaults head_limit to 0 (unlimited) per spec', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-default-limit-'))
    try {
      const total = 60
      for (let i = 0; i < total; i++) {
        await writeFileEnsuringDir(path.join(tmpDir, `f-${String(i).padStart(3, '0')}.txt`), 'hello\n')
      }

      const result = await GrepToolHandler.execute(
        { id: '0', name: 'Grep', input: { pattern: 'hello', path: tmpDir, glob: '**/*' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      const lines = result.content.split('\n').filter(Boolean)
      expect(lines.length).toBe(total)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('defaults to files_with_matches and skips .git/node_modules', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-'))
    try {
      const rootReadme = path.join(tmpDir, 'README.md')
      const dotRules = path.join(tmpDir, '.cursorrules')
      const gitConfig = path.join(tmpDir, '.git', 'config')
      const nodeModFile = path.join(tmpDir, 'node_modules', 'pkg', 'index.js')

      await writeFileEnsuringDir(rootReadme, 'hello\n')
      await writeFileEnsuringDir(dotRules, 'hello\n')
      await writeFileEnsuringDir(gitConfig, 'hello\n')
      await writeFileEnsuringDir(nodeModFile, 'hello\n')

      const result = await GrepToolHandler.execute(
        { id: '1', name: 'Grep', input: { pattern: 'hello', path: tmpDir, glob: '**/*' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      const lines = result.content.split('\n').filter(Boolean)
      expect(lines).toEqual(
        expect.arrayContaining([rootReadme, dotRules]),
      )
      expect(lines.some((l) => l.includes(`${path.sep}.git${path.sep}`))).toBe(false)
      expect(lines.some((l) => l.includes(`${path.sep}node_modules${path.sep}`))).toBe(false)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('supports searching a single file path', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-file-'))
    try {
      const filePath = path.join(tmpDir, 'only.txt')
      await writeFileEnsuringDir(filePath, 'a\nhello\nb\n')

      const result = await GrepToolHandler.execute(
        { id: '2', name: 'Grep', input: { pattern: 'hello', path: filePath, glob: '**/*', output_mode: 'content' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content.split('\n').filter(Boolean)).toEqual([`${filePath}:2:hello`])
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('supports offset/head_limit for files_with_matches', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-grep-head-'))
    try {
      const a = path.join(tmpDir, 'a.txt')
      const b = path.join(tmpDir, 'b.txt')
      const c = path.join(tmpDir, 'c.txt')
      await writeFileEnsuringDir(a, 'hello\n')
      await writeFileEnsuringDir(b, 'hello\n')
      await writeFileEnsuringDir(c, 'hello\n')

      const result = await GrepToolHandler.execute(
        { id: '3', name: 'Grep', input: { pattern: 'hello', path: tmpDir, glob: '**/*', head_limit: 1, offset: 1 } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      const lines = result.content.split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)
      expect([a, b, c]).toContain(lines[0])
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
