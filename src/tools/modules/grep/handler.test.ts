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
  it('searches dotfiles and respects **/* for root-level files', async () => {
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
        expect.arrayContaining([`${rootReadme}:1:hello`, `${dotRules}:1:hello`]),
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
        { id: '2', name: 'Grep', input: { pattern: 'hello', path: filePath, glob: '**/*' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content.split('\n').filter(Boolean)).toEqual([`${filePath}:2:hello`])
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

