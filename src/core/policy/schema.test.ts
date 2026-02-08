import { describe, expect, it } from 'vitest'
import { PolicyRuleSchema, PolicyRulesFileSchema } from './schema.js'

describe('policy schema', () => {
  it('parses a minimal policy rule with defaults', () => {
    const res = PolicyRuleSchema.parse({
      ruleId: 'r1',
      createdAt: '2026-01-01T00:00:00Z',
      scope: 'global',
      decision: 'allow',
      match: { kind: 'fs.read', path: 'src/' },
    })

    expect(res.enabled).toBe(true)
    expect(res.reason).toBe('')
    expect(res.template).toBe('')
  })

  it('parses tool.install match entries', () => {
    const res = PolicyRuleSchema.parse({
      ruleId: 'r-install',
      createdAt: '2026-01-01T00:00:00Z',
      scope: 'global',
      decision: 'deny',
      match: { kind: 'tool.install', tool: 'ripgrep' },
    })
    expect(res.match).toEqual({ kind: 'tool.install', tool: 'ripgrep' })
  })

  it('requires action-specific match fields', () => {
    expect(() =>
      PolicyRuleSchema.parse({
        ruleId: 'r2',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'global',
        decision: 'deny',
        match: { kind: 'bash.exec' },
      }),
    ).toThrow()
  })

  it('is strict about unknown fields', () => {
    expect(() =>
      PolicyRuleSchema.parse({
        ruleId: 'r3',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'global',
        decision: 'allow',
        match: { kind: 'fs.read', path: 'src/' },
        extra: true,
      }),
    ).toThrow()
  })

  it('parses a policy rules file and defaults rules list', () => {
    const parsed = PolicyRulesFileSchema.parse({ version: 1 })
    expect(parsed.rules).toEqual([])
  })
})
