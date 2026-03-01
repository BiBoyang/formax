import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { __testOnlySkillStore, createSkillStore } from './SkillStore'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('SkillStore', () => {
  const originalTtl = process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS

  afterEach(() => {
    if (originalTtl === undefined) {
      delete process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS
    } else {
      process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS = originalTtl
    }
    vi.restoreAllMocks()
  })

  it('loads skills from .formax/skills and maps nested dirs to name using ":"', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'tools', 'ui', 'SKILL.md'),
      ['---', 'description: UI skill', '---', '', 'Do UI things'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list().some((s) => s.name === 'tools:ui')).toBe(true)
    const meta = store.get('tools:ui')
    expect(meta?.description).toBe('UI skill')
    expect(meta?.scope).toBe('project')
  })

  it('finds project skills when running from a subdirectory', async () => {
    const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-root-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(projectRoot, '.formax', 'skills', 'build', 'SKILL.md'),
      ['---', 'description: Build skill', '---', '', 'Build things'].join('\n'),
    )

    const nestedCwd = path.join(projectRoot, 'src', 'nested')
    await fsp.mkdir(nestedCwd, { recursive: true })

    const store = createSkillStore({ cwd: nestedCwd, globalConfigDir })
    expect(store.get('build')?.scope).toBe('project')
  })

  it('loads project skills from .skills compatibility directory', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.skills', 'compat', 'SKILL.md'),
      ['---', 'description: Compat skill', '---', '', 'Do compat things'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    const meta = store.get('compat')
    expect(meta?.scope).toBe('project')
    expect(meta?.description).toBe('Compat skill')
  })

  it('prefers .skills project skill over user skill for same name', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(globalConfigDir, 'skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: User reviewer', '---', '', 'User body'].join('\n'),
    )
    await writeFileEnsuringDir(
      path.join(cwd, '.skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: Compat reviewer', '---', '', 'Compat body'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    const meta = store.get('reviewer')
    expect(meta?.scope).toBe('project')
    expect(meta?.description).toBe('Compat reviewer')
  })

  it('prefers project skill over user skill for same name', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(globalConfigDir, 'skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: User reviewer', '---', '', 'User body'].join('\n'),
    )
    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: Project reviewer', '---', '', 'Project body'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    const meta = store.get('reviewer')
    expect(meta?.scope).toBe('project')
    expect(meta?.description).toBe('Project reviewer')
  })

  it('prefers .formax/skills over .skills for same name', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: Compat reviewer', '---', '', 'Compat body'].join('\n'),
    )
    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'reviewer', 'SKILL.md'),
      ['---', 'description: Project reviewer', '---', '', 'Project body'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    const meta = store.get('reviewer')
    expect(meta?.scope).toBe('project')
    expect(meta?.description).toBe('Project reviewer')
  })

  it('supports disable-model-invocation in frontmatter', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'secret', 'SKILL.md'),
      ['---', 'description: Secret skill', 'disable-model-invocation: true', '---', '', 'Top secret'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.get('secret')?.disableModelInvocation).toBe(true)
  })

  it('falls back to body first meaningful line for description', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'fallback', 'SKILL.md'),
      ['---', '---', '', '# Title', '', 'More text'].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.get('fallback')?.description).toBe('Title')
  })

  it('uses default cache TTL when env ttl is invalid', async () => {
    process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS = 'not-a-number'
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    const first = createSkillStore({ cwd, globalConfigDir })
    const second = createSkillStore({ cwd, globalConfigDir })
    expect(second).toBe(first)
  })

  it('bypasses cache when ttl is zero', async () => {
    process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS = '0'
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    const first = createSkillStore({ cwd, globalConfigDir })
    const second = createSkillStore({ cwd, globalConfigDir })
    expect(second).not.toBe(first)
  })

  it('ignores skills dir when the path exists but is not a directory', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    await writeFileEnsuringDir(path.join(globalConfigDir, 'skills'), 'not-a-dir')

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list()).toEqual([])
  })

  it('tolerates non-file/non-directory dirent entries while scanning', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    await fsp.mkdir(path.join(cwd, '.formax', 'skills'), { recursive: true })

    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      {
        name: 'unknown',
        isDirectory: () => false,
        isFile: () => false,
      } as unknown as fs.Dirent,
    ] as any)

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list()).toEqual([])
  })

  it('ignores close errors when reading skill prefix', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'close-error', 'SKILL.md'),
      ['---', 'description: close error', '---', '', 'Body'].join('\n'),
    )

    vi.spyOn(fs, 'closeSync').mockImplementation(() => {
      throw new Error('close failed')
    })

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.get('close-error')?.description).toBe('close error')
  })

  it('returns empty list when scanDir stat checks throw', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('exists failed')
    })

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list()).toEqual([])
  })

  it('continues scanning when readdirSync throws for a directory', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    await fsp.mkdir(path.join(cwd, '.formax', 'skills'), { recursive: true })

    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('readdir failed')
    })

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list()).toEqual([])
  })

  it('returns null metadata when reading skill prefix throws', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'read-error', 'SKILL.md'),
      ['---', 'description: Read error', '---', '', 'Body'].join('\n'),
    )

    vi.spyOn(fs, 'readSync').mockImplementation(() => {
      throw new Error('read failed')
    })

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.get('read-error')).toBeUndefined()
  })

  it('reuses cached store with positive ttl and returns sorted list', async () => {
    process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS = '5000'
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'zeta', 'SKILL.md'),
      ['---', 'description: zeta', '---', '', 'zeta'].join('\n'),
    )
    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'alpha', 'SKILL.md'),
      ['---', 'description: alpha', '---', '', 'alpha'].join('\n'),
    )

    const first = createSkillStore({ cwd, globalConfigDir })
    const second = createSkillStore({ cwd, globalConfigDir })
    expect(second).toBe(first)
    expect(first.list().map((s) => s.name)).toEqual(['alpha', 'zeta'])
  })

  it('cleans up expired cache entries opportunistically', async () => {
    process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS = '1'
    const cwd1 = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const cwd2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    createSkillStore({ cwd: cwd1, globalConfigDir })
    await new Promise((resolve) => setTimeout(resolve, 5))
    createSkillStore({ cwd: cwd2, globalConfigDir })
  })

  it('ignores non-SKILL.md files and root-level SKILL.md without a derived name', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))
    await writeFileEnsuringDir(path.join(cwd, '.formax', 'skills', 'README.md'), 'ignore me')
    await writeFileEnsuringDir(path.join(cwd, '.formax', 'skills', 'SKILL.md'), ['---', '---', '', 'Body'].join('\n'))

    const files = __testOnlySkillStore.walkSkillFiles(path.join(cwd, '.formax', 'skills'))
    expect(files.some((file) => file.endsWith('README.md'))).toBe(false)

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.list().length).toBe(0)
  })

  it('rejects invalid frontmatter names and empty-description bodies', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-global-'))

    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'bad-name', 'SKILL.md'),
      ['---', 'name: ../evil', 'description: bad', '---', '', 'Body'].join('\n'),
    )
    await writeFileEnsuringDir(
      path.join(cwd, '.formax', 'skills', 'empty-body', 'SKILL.md'),
      ['---', '---', '', '   '].join('\n'),
    )

    const store = createSkillStore({ cwd, globalConfigDir })
    expect(store.get('../evil')).toBeUndefined()
    expect(store.get('empty-body')).toBeUndefined()
  })

  it('builds metadata from plain markdown without frontmatter', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const filePath = path.join(cwd, '.formax', 'skills', 'plain', 'SKILL.md')
    await writeFileEnsuringDir(filePath, 'First line\n\nMore text')

    const meta = __testOnlySkillStore.buildMeta({
      baseDir: path.join(cwd, '.formax', 'skills'),
      filePath,
      scope: 'project',
    })
    expect(meta?.name).toBe('plain')
    expect(meta?.description).toBe('First line')
  })

  it('falls back to "Custom skill" when body has no meaningful first line text', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const filePath = path.join(cwd, '.formax', 'skills', 'custom-fallback', 'SKILL.md')
    await writeFileEnsuringDir(filePath, '#\nSecond line')

    const meta = __testOnlySkillStore.buildMeta({
      baseDir: path.join(cwd, '.formax', 'skills'),
      filePath,
      scope: 'project',
    })
    expect(meta?.name).toBe('custom-fallback')
    expect(meta?.description).toBe('Custom skill')
  })

  it('covers internal name/path validators and empty read prefix', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skills-'))
    const emptyFile = path.join(cwd, 'empty.txt')
    await fsp.writeFile(emptyFile, '')

    expect(__testOnlySkillStore.readTextPrefixUtf8(emptyFile, 16)).toBe('')
    expect(__testOnlySkillStore.dirToSkillName('/tmp/base', '/tmp/base/SKILL.md')).toBeNull()
    expect(__testOnlySkillStore.dirToSkillName('/tmp/base', '/tmp/base/../x/SKILL.md')).toBeNull()
    expect(__testOnlySkillStore.dirToSkillName('/tmp/base', '/tmp/base/./SKILL.md')).toBeNull()
    expect(__testOnlySkillStore.dirToSkillName('/tmp/base', '/tmp/base/bad!/SKILL.md')).toBeNull()

    expect(__testOnlySkillStore.isSafeSkillName('')).toBe(false)
    expect(__testOnlySkillStore.isSafeSkillName('/bad')).toBe(false)
    expect(__testOnlySkillStore.isSafeSkillName('a/../b')).toBe(false)
    expect(__testOnlySkillStore.isSafeSkillName('a\\b')).toBe(false)
    expect(__testOnlySkillStore.isSafeSkillName('a/b')).toBe(false)
    expect(__testOnlySkillStore.isSafeSkillName('ok:name')).toBe(true)

    expect(__testOnlySkillStore.normalizeSkillName('  hello  ')).toBe('hello')
    expect(__testOnlySkillStore.normalizeSkillName(undefined as any)).toBe('')
  })

  it('returns null prefix when openSync fails before fd is initialized', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('open failed')
    })
    expect(__testOnlySkillStore.readTextPrefixUtf8('/tmp/missing', 16)).toBeNull()
  })
})
