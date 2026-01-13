import { describe, expect, it } from 'vitest'
import { evaluatePolicy, explainPolicy } from './engine.js'
import type { PolicyRule } from './schema.js'
import type { PolicyAction } from './types.js'

function makeRule(partial: Pick<PolicyRule, 'ruleId' | 'createdAt' | 'scope' | 'decision' | 'match'> & Partial<PolicyRule>): PolicyRule {
  return {
    enabled: true,
    reason: '',
    template: '',
    ...partial,
  }
}

describe('policy engine', () => {
  it('uses safe defaults when no rules match', () => {
    expect(evaluatePolicy({ action: { kind: 'fs.read', path: '/repo/README.md' }, rules: [] })).toBe('allow')
    expect(evaluatePolicy({ action: { kind: 'fs.write', path: '/repo/tmp.txt' }, rules: [] })).toBe('prompt')
    expect(evaluatePolicy({ action: { kind: 'bash.exec', command: 'ls -la' }, rules: [] })).toBe('allow')
    expect(evaluatePolicy({ action: { kind: 'net.fetch', url: 'https://example.com' }, rules: [] })).toBe('deny')
    expect(evaluatePolicy({ action: { kind: 'net.search', query: 'hello' }, rules: [] })).toBe('deny')
  })

  it('prefers deny over allow even across scopes', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'p-allow-src',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/src' },
      }),
      makeRule({
        ruleId: 'g-deny-src',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'global',
        decision: 'deny',
        match: { kind: 'fs.read', path: '/repo/src' },
      }),
    ]

    const res = explainPolicy({ action: { kind: 'fs.read', path: '/repo/src/index.ts' }, rules })
    expect(res.decision).toBe('deny')
    expect(res.matchedRule?.ruleId).toBe('g-deny-src')
  })

  it('prefers project scope over global when decisions are equal', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'g-allow-src',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'global',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/src/' },
      }),
      makeRule({
        ruleId: 'p-allow-src',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/src/' },
      }),
    ]

    const res = explainPolicy({ action: { kind: 'fs.read', path: '/repo/src/app.ts' }, rules })
    expect(res.decision).toBe('allow')
    expect(res.matchedRule?.scope).toBe('project')
    expect(res.matchedRule?.ruleId).toBe('p-allow-src')
  })

  it('prefers the most specific match within the same decision/scope', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'p-prompt-tmp',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'prompt',
        match: { kind: 'fs.write', path: '/tmp' },
      }),
      makeRule({
        ruleId: 'p-prompt-tmp-foo',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'prompt',
        match: { kind: 'fs.write', path: '/tmp/foo' },
      }),
    ]

    const res = explainPolicy({ action: { kind: 'fs.write', path: '/tmp/foo/bar.txt' }, rules })
    expect(res.decision).toBe('prompt')
    expect(res.matchedRule?.ruleId).toBe('p-prompt-tmp-foo')
  })

  it('ignores disabled rules', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'allow-src-disabled',
        enabled: false,
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/src/' },
      }),
    ]

    const res = explainPolicy({ action: { kind: 'fs.read', path: '/repo/src/app.ts' }, rules })
    expect(res.decision).toBe('allow')
    expect(res.matchedRule).toBeUndefined()
  })

  it('treats path and command prefixes as bounded', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'allow-tmp',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.write', path: '/tmp' },
      }),
      makeRule({
        ruleId: 'allow-rm',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'bash.exec', commandPrefix: 'rm' },
      }),
    ]

    const a1: PolicyAction = { kind: 'fs.write', path: '/tmp1/secret.txt' }
    const r1 = explainPolicy({ action: a1, rules })
    expect(r1.decision).toBe('prompt')
    expect(r1.matchedRule).toBeUndefined()

    const a2: PolicyAction = { kind: 'bash.exec', command: 'rmdir /tmp' }
    const r2 = explainPolicy({ action: a2, rules })
    expect(r2.decision).toBe('allow')
    expect(r2.matchedRule).toBeUndefined()
  })
})
