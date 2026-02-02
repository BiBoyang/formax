import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { buildClaudeMdInjectedBlocks, buildLocalCommandInjectedBlocks, getClaudeMdInjectionMeta } from './injectedBlocks'

describe('repl injected blocks', () => {
  it('injects CLAUDE.md context when present', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nHello\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({ cwd: dir, env: {} as any, homedir: dir })
      expect(blocks).toHaveLength(1)
      expect((blocks[0] as any).text).toContain('# claudeMd')
      expect((blocks[0] as any).text).toContain('Contents of')
      expect((blocks[0] as any).text).toContain('# CLAUDE.md')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects global + project CLAUDE.md with precedence note', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })

      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), '# GLOBAL\n', 'utf8')
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# PROJECT\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('Precedence: project instructions override global user instructions.')

      const globalIdx = text.indexOf('# GLOBAL')
      const projectIdx = text.indexOf('# PROJECT')
      expect(globalIdx).toBeGreaterThanOrEqual(0)
      expect(projectIdx).toBeGreaterThanOrEqual(0)
      expect(globalIdx).toBeLessThan(projectIdx)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('enforces a single combined cap (prefers project content)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })

      const global = 'G'.repeat(150_000) + '\nGLOBAL_END\n'
      const project = 'P'.repeat(150_000) + '\nPROJECT_END\n'
      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), global, 'utf8')
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), project, 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('PROJECT_END')
      expect(text).not.toContain('GLOBAL_END')
      expect(text).toContain('(Truncated)')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes CLAUDE.md injection metadata (capped lengths)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })

      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), 'G'.repeat(5000), 'utf8')
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), 'P'.repeat(10), 'utf8')

      const meta = getClaudeMdInjectionMeta({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })
      expect(meta.capChars).toBeGreaterThan(0)
      expect(meta.project?.scope).toBe('project')
      expect(meta.project?.includedChars).toBe(10)
      expect(meta.global?.scope).toBe('global')
      expect(meta.global?.includedChars).toBeGreaterThan(0)
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
