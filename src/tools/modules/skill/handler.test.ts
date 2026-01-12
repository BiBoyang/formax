import { describe, it, expect } from 'vitest'
import { SkillToolHandler } from './handler'

describe('SkillToolHandler', () => {
  it('validates input and returns not implemented with skill name', async () => {
    const res = await SkillToolHandler.execute(
      { id: 'skill-1', name: 'Skill', input: { skill: 'pdf' } } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Skill "pdf" is not implemented')
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

