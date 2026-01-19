import { describe, expect, it } from 'vitest'
import { explainPermissionDecision, formatPermissionExplainLines } from './explain.js'
import type { LoadedPermissions, PermissionRuleEntry } from './permissionsStore.js'

function mkPermissions(parts: Partial<Pick<LoadedPermissions, 'allow' | 'ask' | 'deny'>>): LoadedPermissions {
  return {
    allow: parts.allow ?? [],
    ask: parts.ask ?? [],
    deny: parts.deny ?? [],
    workspace: { additionalDirectories: [] },
    warnings: [],
  }
}

function mkRule(rule: string, scope: PermissionRuleEntry['scope']): PermissionRuleEntry {
  return { rule, scope, filePath: `/${scope}.json` }
}

describe('permissions explain', () => {
  it('returns none when no rule matches', () => {
    const permissions = mkPermissions({})
    const expl = explainPermissionDecision({ permissions, toolName: 'Read', toolSpec: '/tmp/a.txt' })
    expect(expl.decision).toBe('none')
    expect(expl.matchedRule).toBeNull()
    expect(expl.suggestions.length).toBeGreaterThan(0)

    const lines = formatPermissionExplainLines(expl)
    expect(lines[0]).toBe('PermissionDecision: none')
    expect(lines.join('\n')).toContain('PermissionReason:')
  })

  it('explains deny with scope and file', () => {
    const permissions = mkPermissions({
      deny: [mkRule('Bash(ls:*)', 'projectLocal')],
    })
    const expl = explainPermissionDecision({ permissions, toolName: 'Bash', toolSpec: 'ls -la' })
    expect(expl.decision).toBe('deny')
    expect(expl.matchedRule?.rule).toBe('Bash(ls:*)')
    expect(expl.reason).toContain('project local settings')

    const lines = formatPermissionExplainLines(expl).join('\n')
    expect(lines).toContain('PermissionRule: Bash(ls:*)')
    expect(lines).toContain('PermissionScope: project local')
    expect(lines).toContain('PermissionFile: /projectLocal.json')
    expect(lines).toContain('PermissionSuggestions:')
  })

  it('explains ask with suggestions', () => {
    const permissions = mkPermissions({
      ask: [mkRule('Skill(frontend-design)', 'project')],
    })
    const expl = explainPermissionDecision({ permissions, toolName: 'Skill', toolSpec: 'frontend-design' })
    expect(expl.decision).toBe('ask')
    expect(expl.matchedRule?.rule).toBe('Skill(frontend-design)')
    expect(expl.suggestions.length).toBeGreaterThan(0)
  })

  it('explains allow without suggestions', () => {
    const permissions = mkPermissions({
      allow: [mkRule('WebFetch', 'user')],
    })
    const expl = explainPermissionDecision({ permissions, toolName: 'WebFetch' })
    expect(expl.decision).toBe('allow')
    expect(expl.matchedRule?.rule).toBe('WebFetch')
    expect(expl.suggestions).toEqual([])
  })
})

