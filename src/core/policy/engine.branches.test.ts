import { describe, expect, it } from 'vitest'
import { explainPolicy } from './engine'
import type { PolicyRule } from './schema'

function makeRule(partial: Pick<PolicyRule, 'ruleId' | 'createdAt' | 'scope' | 'decision' | 'match'> & Partial<PolicyRule>): PolicyRule {
  return {
    enabled: true,
    reason: '',
    template: '',
    ...partial,
  }
}

describe('policy engine branch guards', () => {
  it('keeps better candidate when a later rule has lower priority (continue branch)', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'deny-first',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'deny',
        match: { kind: 'fs.read', path: '/repo/src' },
      }),
      makeRule({
        ruleId: 'allow-later',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/src' },
      }),
    ]

    const out = explainPolicy({ action: { kind: 'fs.read', path: '/repo/src/index.ts' }, rules })
    expect(out.decision).toBe('deny')
    expect(out.matchedRule?.ruleId).toBe('deny-first')
  })

  it('handles slash normalization and bounded matches', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'win-path',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: 'C:\\repo\\src' },
      }),
      makeRule({
        ruleId: 'bash-word',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'bash.exec', commandPrefix: 'rm' },
      }),
    ]

    expect(explainPolicy({ action: { kind: 'fs.read', path: 'C:/repo/src/file.ts' }, rules }).matchedRule?.ruleId).toBe('win-path')
    expect(explainPolicy({ action: { kind: 'bash.exec', command: 'rm -rf tmp' }, rules }).matchedRule?.ruleId).toBe('bash-word')
    expect(explainPolicy({ action: { kind: 'bash.exec', command: 'rmdir tmp' }, rules }).matchedRule).toBeUndefined()
  })

  it('returns default deny suggestion for network actions without rules', () => {
    const out = explainPolicy({ action: { kind: 'net.fetch', url: 'https://x' }, rules: [] })
    expect(out.decision).toBe('deny')
    expect(out.suggestions[0]).toContain('Network access is denied by default')
  })

  it('covers all matcher kinds with non-matching candidates filtered out', () => {
    const rules: PolicyRule[] = [
      makeRule({
        ruleId: 'fetch-prefix',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'prompt',
        match: { kind: 'net.fetch', urlPrefix: 'https://allowed.example/' },
      }),
      makeRule({
        ruleId: 'search-prefix',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'net.search', queryPrefix: 'hello world' },
      }),
      makeRule({
        ruleId: 'install-tool',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'deny',
        match: { kind: 'tool.install', tool: 'ripgrep' },
      }),
    ]

    expect(explainPolicy({ action: { kind: 'net.fetch', url: 'https://allowed.example/path' }, rules }).matchedRule?.ruleId).toBe(
      'fetch-prefix',
    )
    expect(explainPolicy({ action: { kind: 'net.search', query: 'hello world now' }, rules }).matchedRule?.ruleId).toBe(
      'search-prefix',
    )
    expect(explainPolicy({ action: { kind: 'tool.install', tool: 'ripgrep' }, rules }).matchedRule?.ruleId).toBe('install-tool')
  })

  it('covers exact and non-matching boundaries for path/word and non-matching tool/url/query values', () => {
    const pathRules: PolicyRule[] = [
      makeRule({
        ruleId: 'exact-path',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'fs.read', path: '/repo/exact' },
      }),
    ]
    expect(explainPolicy({ action: { kind: 'fs.read', path: '/repo/exact' }, rules: pathRules }).matchedRule?.ruleId).toBe(
      'exact-path',
    )
    expect(explainPolicy({ action: { kind: 'fs.read', path: '/repo/other' }, rules: pathRules }).matchedRule).toBeUndefined()

    const bashRules: PolicyRule[] = [
      makeRule({
        ruleId: 'bash-exact',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'bash.exec', commandPrefix: 'echo' },
      }),
    ]
    expect(explainPolicy({ action: { kind: 'bash.exec', command: 'echo' }, rules: bashRules }).matchedRule?.ruleId).toBe(
      'bash-exact',
    )
    expect(explainPolicy({ action: { kind: 'bash.exec', command: 'printf x' }, rules: bashRules }).matchedRule).toBeUndefined()

    const netToolRules: PolicyRule[] = [
      makeRule({
        ruleId: 'fetch-prefix',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'net.fetch', urlPrefix: 'https://allowed.example/' },
      }),
      makeRule({
        ruleId: 'search-prefix',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'net.search', queryPrefix: 'find me' },
      }),
      makeRule({
        ruleId: 'install-tool',
        createdAt: '2026-01-01T00:00:00Z',
        scope: 'project',
        decision: 'allow',
        match: { kind: 'tool.install', tool: 'ripgrep' },
      }),
    ]

    expect(
      explainPolicy({ action: { kind: 'net.fetch', url: 'https://denied.example/path' }, rules: netToolRules }).matchedRule,
    ).toBeUndefined()
    expect(explainPolicy({ action: { kind: 'net.search', query: 'other query' }, rules: netToolRules }).matchedRule).toBeUndefined()
    expect(explainPolicy({ action: { kind: 'tool.install', tool: 'fd' }, rules: netToolRules }).matchedRule).toBeUndefined()
  })
})
