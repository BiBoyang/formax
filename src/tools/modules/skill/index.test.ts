import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { buildSkillToolSpecForCwd } from './index'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('buildSkillToolSpecForCwd', () => {
  it('injects available skills for the current repo and varies by cwd', async () => {
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    process.env.FORMAX_CONFIG_DIR = globalConfigDir

    const projectA = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-project-a-'))
    const projectB = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-project-b-'))

    try {
      await writeFileEnsuringDir(
        path.join(projectA, '.formax', 'skills', 'alpha', 'SKILL.md'),
        ['---', 'description: Alpha skill', '---', '', 'Do alpha'].join('\n'),
      )
      await writeFileEnsuringDir(
        path.join(projectB, '.formax', 'skills', 'beta', 'SKILL.md'),
        ['---', 'description: Beta skill', '---', '', 'Do beta'].join('\n'),
      )

      const specA = buildSkillToolSpecForCwd(projectA)
      const specB = buildSkillToolSpecForCwd(projectB)

      expect(specA.description).toContain('<skill>\n<name>\nalpha\n</name>')
      expect(specA.description).toContain('<description>\nAlpha skill (project)\n</description>')
      expect(specA.description).toContain('<location>\nmanaged\n</location>')
      expect(specA.description).not.toContain('<name>\nbeta\n</name>')

      expect(specB.description).toContain('<skill>\n<name>\nbeta\n</name>')
      expect(specB.description).toContain('<description>\nBeta skill (project)\n</description>')
      expect(specB.description).toContain('<location>\nmanaged\n</location>')
      expect(specB.description).not.toContain('<name>\nalpha\n</name>')

      // The tool description should not leak absolute filesystem paths for skills.
      expect(specA.description).not.toContain(path.join(projectA, '.formax', 'skills'))
      expect(specB.description).not.toContain(path.join(projectB, '.formax', 'skills'))
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir

      await fsp.rm(globalConfigDir, { recursive: true, force: true })
      await fsp.rm(projectA, { recursive: true, force: true })
      await fsp.rm(projectB, { recursive: true, force: true })
    }
  })

  it('adds truncation marker when available skills exceed char budget', async () => {
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevBudget = process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET
    const globalConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-global-'))
    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET = '10'

    const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-skill-project-'))

    try {
      await writeFileEnsuringDir(
        path.join(project, '.formax', 'skills', 'alpha', 'SKILL.md'),
        ['---', 'description: Alpha skill', '---', '', 'Do alpha'].join('\n'),
      )
      await writeFileEnsuringDir(
        path.join(project, '.formax', 'skills', 'beta', 'SKILL.md'),
        ['---', 'description: Beta skill', '---', '', 'Do beta'].join('\n'),
      )

      const spec = buildSkillToolSpecForCwd(project)
      expect(spec.description).toContain('<truncated>true</truncated>')
    } finally {
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir

      if (prevBudget === undefined) delete process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET
      else process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET = prevBudget

      await fsp.rm(globalConfigDir, { recursive: true, force: true })
      await fsp.rm(project, { recursive: true, force: true })
    }
  })
})
