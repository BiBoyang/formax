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
})

