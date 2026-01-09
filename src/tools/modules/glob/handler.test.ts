import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GlobToolHandler } from './handler'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('GlobToolHandler', () => {
  it('matches dotfiles but skips .git and node_modules', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-glob-'))
    try {
      const rootReadme = path.join(tmpDir, 'README.md')
      const dotRules = path.join(tmpDir, '.cursorrules')
      const ghInstructions = path.join(tmpDir, '.github', 'copilot-instructions.md')
      const gitHead = path.join(tmpDir, '.git', 'HEAD')
      const nodeModFile = path.join(tmpDir, 'node_modules', 'pkg', 'index.js')
      const srcFile = path.join(tmpDir, 'src', 'index.ts')

      await writeFileEnsuringDir(rootReadme, 'root\n')
      await writeFileEnsuringDir(dotRules, 'rules\n')
      await writeFileEnsuringDir(ghInstructions, 'instructions\n')
      await writeFileEnsuringDir(gitHead, 'ref: refs/heads/main\n')
      await writeFileEnsuringDir(nodeModFile, 'ignored\n')
      await writeFileEnsuringDir(srcFile, 'export {}\n')

      const result = await GlobToolHandler.execute(
        { id: '1', name: 'Glob', input: { pattern: '**/*' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      const lines = result.content.split('\n').filter(Boolean)
      expect(lines).toEqual(
        expect.arrayContaining([rootReadme, dotRules, ghInstructions, srcFile]),
      )
      expect(lines.some((l) => l.includes(`${path.sep}.git${path.sep}`))).toBe(false)
      expect(lines.some((l) => l.includes(`${path.sep}node_modules${path.sep}`))).toBe(false)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

