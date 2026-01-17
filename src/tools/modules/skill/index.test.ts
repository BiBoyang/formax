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

      expect(specA.description).toContain('- alpha: Alpha skill')
      expect(specA.description).not.toContain('- beta: Beta skill')
      expect(specB.description).toContain('- beta: Beta skill')
      expect(specB.description).not.toContain('- alpha: Alpha skill')

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
})

