import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { SkillToolHandler } from './handler'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('SkillToolHandler', () => {
  it('matches only the Skill tool name', () => {
    expect(SkillToolHandler.canHandle('Skill')).toBe(true)
    expect(SkillToolHandler.canHandle('Read')).toBe(false)
  })

  it('loads a skill from disk and returns its instructions', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      const skillPath = path.join(cwd, '.formax', 'skills', 'pdf', 'SKILL.md')
      await writeFileEnsuringDir(skillPath, ['---', 'description: PDF skill', '---', '', 'Do PDF stuff'].join('\n'))

      const res = await SkillToolHandler.execute(
        { id: 'skill-1', name: 'Skill', input: { skill: 'pdf' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBeUndefined()
      expect(res.content).toBe('Launching skill: pdf')
      expect(res.extraTextBlocks).toBeTruthy()
      expect(res.extraTextBlocks![0]).toContain(`Base directory for this skill: ${path.dirname(skillPath)}`)
      expect(res.extraTextBlocks![0]).toContain('Do PDF stuff')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('reports unknown skills and includes available list', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'skills', 'xlsx', 'SKILL.md'),
        ['---', 'description: XLSX skill', '---', '', 'Do XLSX stuff'].join('\n'),
      )

      const res = await SkillToolHandler.execute(
        { id: 'skill-unknown', name: 'Skill', input: { skill: 'nope' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBe(true)
      expect(res.content).toContain('Unknown skill: nope')
      expect(res.content).toContain('Available skills:')
      expect(res.content).toContain('xlsx')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('rejects disabled skills', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'skills', 'secret', 'SKILL.md'),
        ['---', 'description: Secret skill', 'disable-model-invocation: true', '---', '', 'Top secret'].join('\n'),
      )

      const res = await SkillToolHandler.execute(
        { id: 'skill-disabled', name: 'Skill', input: { skill: 'secret' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBe(true)
      expect(res.content).toContain('disabled for model invocation')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('rejects unknown fields', async () => {
    const res = await SkillToolHandler.execute(
      { id: 'skill-2', name: 'Skill', input: { skill: 'pdf', extra: true } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('unknown field')
  })

  it('rejects missing skill', async () => {
    const res = await SkillToolHandler.execute(
      { id: 'skill-3', name: 'Skill', input: {} } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing skill')
  })

  it('rejects missing skill when input is omitted', async () => {
    const res = await SkillToolHandler.execute(
      { id: 'skill-3b', name: 'Skill' } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing skill')
  })

  it('uses process.cwd when ctx.cwd is missing', async () => {
    const res = await SkillToolHandler.execute(
      { id: 'skill-cwd-fallback', name: 'Skill', input: { skill: 'definitely-missing-skill' } } as any,
      { agentDepth: 0 } as any,
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Unknown skill: definitely-missing-skill')
  })

  it('shows (none) when there are no available skills', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      const res = await SkillToolHandler.execute(
        { id: 'skill-none', name: 'Skill', input: { skill: 'nope' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBe(true)
      expect(res.content).toContain('Available skills: (none)')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('loads a plain markdown skill without frontmatter', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      const skillPath = path.join(cwd, '.formax', 'skills', 'plain', 'SKILL.md')
      await writeFileEnsuringDir(skillPath, 'Just plain instructions')

      const res = await SkillToolHandler.execute(
        { id: 'skill-plain', name: 'Skill', input: { skill: 'plain' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBeUndefined()
      expect(res.content).toBe('Launching skill: plain')
      expect(res.extraTextBlocks?.[0]).toContain('Just plain instructions')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('rejects empty skill body', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'skills', 'empty', 'SKILL.md'),
        ['---', 'description: empty', '---', '', '   '].join('\n'),
      )

      const res = await SkillToolHandler.execute(
        { id: 'skill-empty', name: 'Skill', input: { skill: 'empty' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBe(true)
      expect(res.content).toContain('Empty skill file: empty')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('uses FORMAX_SKILL_BODY_CHAR_BUDGET when valid and marks truncated output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevBudget = process.env.FORMAX_SKILL_BODY_CHAR_BUDGET
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.env.FORMAX_SKILL_BODY_CHAR_BUDGET = '10'
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'skills', 'tiny', 'SKILL.md'),
        ['---', 'description: tiny budget', '---', '', '012345678901234567890123456789'].join('\n'),
      )

      const res = await SkillToolHandler.execute(
        { id: 'skill-truncate', name: 'Skill', input: { skill: 'tiny' } } as any,
        { cwd, agentDepth: 0 },
      )

      expect(res.is_error).toBeUndefined()
      expect(res.content).toBe('Launching skill: tiny')
      expect(res.extraTextBlocks?.[0]).toContain('… (truncated)')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      if (prevBudget === undefined) delete process.env.FORMAX_SKILL_BODY_CHAR_BUDGET
      else process.env.FORMAX_SKILL_BODY_CHAR_BUDGET = prevBudget
      await fsp.rm(cwd, { recursive: true, force: true })
      await fsp.rm(globalConfigDir, { recursive: true, force: true })
    }
  })

  it('converts non-Error throwables into error text', async () => {
    const call = { id: 'skill-non-error', name: 'Skill' } as any
    Object.defineProperty(call, 'input', {
      get() {
        throw 'boom'
      },
    })

    const res = await SkillToolHandler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Error: boom')
  })
})
