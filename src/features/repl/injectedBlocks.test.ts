import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { buildClaudeMdInjectedBlocks, buildLocalCommandInjectedBlocks } from './injectedBlocks'

describe('repl injected blocks', () => {
  it('injects CLAUDE.md context when present', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nHello\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({ cwd: dir })
      expect(blocks).toHaveLength(1)
      expect((blocks[0] as any).text).toContain('# claudeMd')
      expect((blocks[0] as any).text).toContain('Contents of')
      expect((blocks[0] as any).text).toContain('# CLAUDE.md')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('builds local command injected blocks', () => {
    const blocks = buildLocalCommandInjectedBlocks({
      commandName: '/todos',
      commandMessage: 'todos',
      commandArgs: '',
      stdout: 'hi',
    })
    expect(blocks).toHaveLength(3)
    expect((blocks[0] as any).text).toContain('Caveat:')
    expect((blocks[1] as any).text).toContain('<command-name>/todos</command-name>')
    expect((blocks[2] as any).text).toContain('<local-command-stdout>hi</local-command-stdout>')
  })
})
