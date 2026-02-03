import { describe, expect, it } from 'vitest'
import type { LoadedPermissions, PermissionRuleEntry, WorkspaceDirectoryEntry } from '../../adapters/permissions/permissionsStore.js'
import { buildListItems, filterEntries, formatScopeLabel, formatWorkspaceDirLabel, getListKind, nextTab } from './utils.js'

function makeRule(rule: string, scope: 'user' | 'project' | 'projectLocal' = 'user'): PermissionRuleEntry {
  return { rule, scope, filePath: `/tmp/${scope}.json` }
}

function makeDir(dir: string, scope: 'user' | 'project' | 'projectLocal' = 'user'): WorkspaceDirectoryEntry {
  return { dir, scope, filePath: `/tmp/${scope}.json` }
}

function makePermissions(overrides?: Partial<LoadedPermissions>): LoadedPermissions {
  return {
    allow: [],
    ask: [],
    deny: [],
    workspace: { additionalDirectories: [] },
    warnings: [],
    ...overrides,
  }
}

describe('permissions/utils', () => {
  it('formatScopeLabel uses human-readable labels', () => {
    expect(formatScopeLabel('projectLocal')).toBe('project local settings')
    expect(formatScopeLabel('project')).toBe('project settings')
    expect(formatScopeLabel('user')).toBe('user settings')
  })

  it('nextTab cycles across allow/ask/deny/workspace', () => {
    expect(nextTab('allow', 1)).toBe('ask')
    expect(nextTab('workspace', 1)).toBe('allow')
    expect(nextTab('allow', -1)).toBe('workspace')
  })

  it('getListKind maps workspace to null', () => {
    expect(getListKind('workspace')).toBe(null)
    expect(getListKind('allow')).toBe('allow')
  })

  it('formatWorkspaceDirLabel prefers basename', () => {
    expect(formatWorkspaceDirLabel('/tmp/foo/bar')).toBe('bar')
    expect(formatWorkspaceDirLabel('bar')).toBe('bar')
  })

  it('filterEntries is case-insensitive', () => {
    const entries = [
      { key: 'a', label: 'Read:*' },
      { key: 'b', label: 'Write:*' },
    ]
    expect(filterEntries(entries, 'read')).toEqual([{ key: 'a', label: 'Read:*' }])
    expect(filterEntries(entries, '')).toEqual(entries)
  })

  it('buildListItems includes an add item and filters rules', () => {
    const permissions = makePermissions({
      allow: [makeRule('Read:*'), makeRule('Glob:**/*.ts')],
    })

    const all = buildListItems({ tab: 'allow', permissions, searchQuery: '' })
    expect(all[0]).toEqual({ type: 'add', key: 'add', label: 'Add a new rule...' })

    const filtered = buildListItems({ tab: 'allow', permissions, searchQuery: 'glob' })
    expect(filtered.some((i) => i.type === 'rule' && i.label === 'Glob:**/*.ts')).toBe(true)
    expect(filtered.some((i) => i.type === 'rule' && i.label === 'Read:*')).toBe(false)
  })

  it('buildListItems includes an add item and filters workspace directories', () => {
    const permissions = makePermissions({
      workspace: { additionalDirectories: [makeDir('/tmp/projectA'), makeDir('/tmp/projectB')] },
    })

    const all = buildListItems({ tab: 'workspace', permissions, searchQuery: '' })
    expect(all[0]).toEqual({ type: 'add', key: 'add', label: 'Add directory' })

    const filtered = buildListItems({ tab: 'workspace', permissions, searchQuery: 'projectb' })
    expect(filtered.some((i) => i.type === 'dir' && i.label === 'projectB')).toBe(true)
    expect(filtered.some((i) => i.type === 'dir' && i.label === 'projectA')).toBe(false)
  })
})

