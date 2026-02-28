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
})
