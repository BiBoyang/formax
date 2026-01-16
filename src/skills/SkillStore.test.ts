import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createSkillStore } from './SkillStore'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('SkillStore', () => {
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
})
