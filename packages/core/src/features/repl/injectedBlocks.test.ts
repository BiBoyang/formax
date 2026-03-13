import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import {
  buildBashModeInjectedBlocks,
  buildClaudeMdInjectedBlocks,
  buildLocalCommandInjectedBlocks,
  getClaudeMdInjectionMeta,
} from './injectedBlocks'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath'

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

  it('injects auto-memory contents into the claudeMd reminder block', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), '# PROJECT\n', 'utf8')

      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: globalDir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), '# Memory\nline-1\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('Contents of')
      expect(text).toContain("user's auto-memory, persists across conversations")
      expect(text).toContain('# Memory')
      expect(text).toContain('line-1')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects memory-only context when CLAUDE.md files are absent', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: globalDir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), 'memory-only\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('# claudeMd')
      expect(text).toContain('memory-only')
      expect(text).toContain("user's auto-memory, persists across conversations")
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('truncates injected MEMORY.md content to 200 lines', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: globalDir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      const memoryText = Array.from({ length: 220 }, (_, i) => `line-${i + 1}`).join('\n')
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), memoryText, 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })

      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('line-200')
      expect(text).not.toContain('line-201')

      const meta = getClaudeMdInjectionMeta({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })
      expect(meta.memory?.originalLines).toBe(220)
      expect(meta.memory?.includedLines).toBe(200)
      expect(meta.memory?.truncated).toBe(true)
      expect(meta.memory?.includedSha256).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not inject MEMORY.md when auto-memory is disabled for the turn', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      const memoryDir = buildAutoMemoryDirectoryPath({
        cwd: dir,
        configDir: globalDir,
      })
      await fsp.mkdir(memoryDir, { recursive: true })
      await fsp.writeFile(path.join(memoryDir, 'MEMORY.md'), 'should-not-appear\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
        includeAutoMemory: false,
      })
      expect(blocks).toEqual([])

      const meta = getClaudeMdInjectionMeta({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
        includeAutoMemory: false,
      })
      expect(meta.memory).toBeNull()
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
      expect(meta.project?.includedSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(meta.global?.scope).toBe('global')
      expect(meta.global?.includedChars).toBeGreaterThan(0)
      expect(meta.global?.includedSha256).toMatch(/^[a-f0-9]{64}$/)
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

  it('handles CLAUDE.md read failures gracefully', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1, mtimeMs: 1 } as any)
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('read fail')
      })

      const blocks = buildClaudeMdInjectedBlocks({ cwd: dir, env: {} as any, homedir: dir })
      const meta = getClaudeMdInjectionMeta({ cwd: dir, env: {} as any, homedir: dir })

      expect(blocks).toEqual([])
      expect(meta.global).toBeNull()
      expect(meta.project).toBeNull()

      readSpy.mockRestore()
      statSpy.mockRestore()
      existsSpy.mockRestore()
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('builds escaped bash-mode injected blocks and truncates long output', () => {
    const longStdout = `<tag>${'x'.repeat(31_000)}</tag>`
    const blocks = buildBashModeInjectedBlocks({
      input: '  echo <ok> & done  ',
      stdout: longStdout,
      stderr: '</stderr> & fail',
    })

    expect(blocks).toHaveLength(2)
    const text = String((blocks[1] as any).text || '')
    expect(text).toContain('<bash-input>echo &lt;ok&gt; &amp; done</bash-input>')
    expect(text).toContain('<bash-stdout>')
    expect(text).toContain('&lt;tag&gt;')
    expect(text).toContain('(Truncated)')
    expect(text).toContain('<bash-stderr>&lt;/stderr&gt; &amp; fail</bash-stderr>')
  })

  it('injects only global CLAUDE.md when project file is missing', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), '# GLOBAL ONLY\n', 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })
      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('# GLOBAL ONLY')
      expect(text).not.toContain('project instructions, checked into the codebase')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses full cap for project and leaves no global content when project exceeds cap', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), 'GLOBAL_SHOULD_NOT_APPEAR', 'utf8')
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), 'P'.repeat(210_000), 'utf8')

      const blocks = buildClaudeMdInjectedBlocks({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })
      expect(blocks).toHaveLength(1)
      const text = String((blocks[0] as any).text || '')
      expect(text).toContain('project instructions, checked into the codebase')
      expect(text).not.toContain('GLOBAL_SHOULD_NOT_APPEAR')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('slices truncated marker when remaining global budget is tiny', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const globalDir = path.join(dir, 'global')
      await fsp.mkdir(globalDir, { recursive: true })
      await fsp.writeFile(path.join(globalDir, 'CLAUDE.md'), 'GLOBAL1234567890', 'utf8')
      await fsp.writeFile(path.join(dir, 'CLAUDE.md'), 'P'.repeat(199_996), 'utf8')

      const meta = getClaudeMdInjectionMeta({
        cwd: dir,
        env: { FORMAX_CONFIG_DIR: globalDir } as any,
        homedir: dir,
      })
      expect(meta.global?.includedChars).toBe(4)
      expect(meta.global?.truncated).toBe(true)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('handles undefined bash-mode fields by coercing to empty strings', () => {
    const blocks = buildBashModeInjectedBlocks({
      input: undefined as any,
      stdout: undefined as any,
      stderr: undefined as any,
    })
    expect(blocks).toHaveLength(2)
    const text = String((blocks[1] as any).text || '')
    expect(text).toContain('<bash-input></bash-input>')
    expect(text).toContain('<bash-stdout></bash-stdout>')
    expect(text).toContain('<bash-stderr></bash-stderr>')
  })

  it('uses process defaults for env/platform/homedir arguments when omitted', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-injected-'))
    try {
      const blocks = buildClaudeMdInjectedBlocks({ cwd: dir })
      expect(blocks).toEqual([])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
