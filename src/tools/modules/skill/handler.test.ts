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
  it('loads a skill from disk and returns its instructions', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir

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

    if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
    else process.env.FORMAX_CONFIG_DIR = prevConfigDir
    await fsp.rm(cwd, { recursive: true, force: true })
    await fsp.rm(globalConfigDir, { recursive: true, force: true })
  })

  it('reports unknown skills and includes available list', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir

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

    if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
    else process.env.FORMAX_CONFIG_DIR = prevConfigDir
    await fsp.rm(cwd, { recursive: true, force: true })
    await fsp.rm(globalConfigDir, { recursive: true, force: true })
  })

  it('rejects disabled skills', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-cwd-'))
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = globalConfigDir

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

    if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
    else process.env.FORMAX_CONFIG_DIR = prevConfigDir
    await fsp.rm(cwd, { recursive: true, force: true })
    await fsp.rm(globalConfigDir, { recursive: true, force: true })
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
})
