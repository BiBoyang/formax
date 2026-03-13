import { describe, expect, it } from 'vitest'
import { decideToolPermission } from './matcher.js'
import type { LoadedPermissions } from './permissionsStore.js'

function permissions(args: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
}): LoadedPermissions {
  const toEntries = (kind: 'allow' | 'ask' | 'deny') =>
    (args[kind] ?? []).map((rule) => ({ rule, scope: 'projectLocal' as const, filePath: '/x/settings.local.json' }))

  return {
    allow: toEntries('allow'),
    ask: toEntries('ask'),
    deny: toEntries('deny'),
    workspace: { additionalDirectories: [] },
    warnings: [],
  }
}

describe('decideToolPermission', () => {
  it('returns deny before ask/allow', () => {
    const res = decideToolPermission({
      permissions: permissions({ allow: ['Bash(ls:*)'], ask: ['Bash(ls:*)'], deny: ['Bash(ls:*)'] }),
      toolName: 'Bash',
      toolSpec: 'ls -la',
    })
    expect(res.decision).toBe('deny')
    expect(res.match?.kind).toBe('deny')
  })

  it('matches tool-only rule', () => {
    const res = decideToolPermission({
      permissions: permissions({ ask: ['WebFetch'] }),
      toolName: 'WebFetch',
      toolSpec: 'https://example.com',
    })
    expect(res.decision).toBe('ask')
    expect(res.match?.entry.rule).toBe('WebFetch')
  })

  it('matches non-bash parenthesized rule with empty spec', () => {
    const res = decideToolPermission({
      permissions: permissions({ ask: ['WebFetch()'] }),
      toolName: 'WebFetch',
      toolSpec: 'https://example.com',
    })
    expect(res.decision).toBe('ask')
    expect(res.match?.entry.rule).toBe('WebFetch()')
  })

  it('matches non-bash parenthesized rule with exact spec', () => {
    const p = permissions({ allow: ['Read(/tmp/a.txt)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Read', toolSpec: '/tmp/a.txt' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Read', toolSpec: '/tmp/b.txt' }).decision).toBe('none')
  })

  it('matches bash prefix rules', () => {
    const p = permissions({ allow: ['Bash(ls:*)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls -la' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'lsof -i' }).decision).toBe('none')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'lsfoo' }).decision).toBe('none')
  })

  it('matches bash exact rules', () => {
    const p = permissions({ allow: ['Bash(ls -la)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls -la' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls' }).decision).toBe('none')
  })

  it('matches bash glob rules', () => {
    const p = permissions({ allow: ['Bash(ls*)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls -la' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'lsof -i' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'lsfoo' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'cat a.txt' }).decision).toBe('none')
  })

  it('does not treat Bash(*) as match-all', () => {
    const p = permissions({ allow: ['Bash(*)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls -la' }).decision).toBe('none')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'cat a.txt' }).decision).toBe('none')
  })

  it('ignores empty rules and empty tool names', () => {
    const p = permissions({ allow: ['   '] })
    expect(decideToolPermission({ permissions: p, toolName: 'Read', toolSpec: '/tmp/a' }).decision).toBe('none')
    expect(decideToolPermission({ permissions: p, toolName: '' as any, toolSpec: '/tmp/a' }).decision).toBe('none')
  })

  it('returns none for Bash rules when command is empty', () => {
    const p = permissions({ allow: ['Bash(ls:*)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: '' }).decision).toBe('none')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: undefined as any }).decision).toBe('none')
  })

  it('treats Bash() as match-all for non-empty commands', () => {
    const p = permissions({ allow: ['Bash()'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'echo hi' }).decision).toBe('allow')
  })

  it('rejects invalid Bash(:*) prefix form and non-prefix commands', () => {
    const invalidPrefix = permissions({ allow: ['Bash(:*)'] })
    expect(decideToolPermission({ permissions: invalidPrefix, toolName: 'Bash', toolSpec: 'ls -la' }).decision).toBe('none')

    const prefix = permissions({ allow: ['Bash(ls:*)'] })
    expect(decideToolPermission({ permissions: prefix, toolName: 'Bash', toolSpec: 'cat file.txt' }).decision).toBe('none')
  })

  it('handles glob patterns with regex-like characters literally except * wildcard', () => {
    const p = permissions({ allow: ['Bash(ls?.*)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls?.txt' }).decision).toBe('allow')
    expect(decideToolPermission({ permissions: p, toolName: 'Bash', toolSpec: 'ls1.txt' }).decision).toBe('none')
  })

  it('does not match parenthesized rules with different tool names', () => {
    const p = permissions({ allow: ['Read(/tmp/a.txt)'] })
    expect(decideToolPermission({ permissions: p, toolName: 'WebFetch', toolSpec: '/tmp/a.txt' }).decision).toBe('none')
  })

  it('ignores malformed parenthesized rules', () => {
    const p = permissions({ allow: ['Read(/tmp/a.txt'] })
    expect(decideToolPermission({ permissions: p, toolName: 'Read', toolSpec: '/tmp/a.txt' }).decision).toBe('none')
  })

  it('handles missing toolName defensively for non-empty rules', () => {
    const p = permissions({ allow: ['Read'] })
    expect(decideToolPermission({ permissions: p, toolName: undefined as any, toolSpec: '/tmp/a.txt' }).decision).toBe('none')
  })
})
