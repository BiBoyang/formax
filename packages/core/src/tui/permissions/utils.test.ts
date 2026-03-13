import { describe, expect, it, vi } from 'vitest'
import type { LoadedPermissions, PermissionRuleEntry, WorkspaceDirectoryEntry } from '../../adapters/permissions/permissionsStore.js'
import {
  buildListItems,
  clamp,
  filterEntries,
  formatScopeLabel,
  formatWorkspaceDirLabel,
  formatWorkspaceSourceLabel,
  getListKind,
  nextTab,
  persistWorkspaceDirFromInput,
} from './utils.js'

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
    expect(formatScopeLabel('unknown' as any)).toBe('settings')
  })

  it('nextTab cycles across allow/ask/deny/workspace', () => {
    expect(nextTab('allow', 1)).toBe('ask')
    expect(nextTab('workspace', 1)).toBe('allow')
    expect(nextTab('allow', -1)).toBe('workspace')
    expect(nextTab('unknown' as any, 1)).toBe('ask')
  })

  it('getListKind maps workspace to null', () => {
    expect(getListKind('workspace')).toBe(null)
    expect(getListKind('allow')).toBe('allow')
  })

  it('formatWorkspaceDirLabel prefers basename', () => {
    expect(formatWorkspaceDirLabel('/tmp/foo/bar')).toBe('bar')
    expect(formatWorkspaceDirLabel('bar')).toBe('bar')
    expect(formatWorkspaceDirLabel('')).toBe('')
    expect(formatWorkspaceDirLabel('/')).toBe('/')
  })

  it('clamp handles NaN/min/max edges', () => {
    expect(clamp(Number.NaN, 1, 3)).toBe(1)
    expect(clamp(0, 1, 3)).toBe(1)
    expect(clamp(9, 1, 3)).toBe(3)
    expect(clamp(2, 1, 3)).toBe(2)
  })

  it('filterEntries is case-insensitive', () => {
    const entries = [
      { key: 'a', label: 'Read:*' },
      { key: 'b', label: 'Write:*' },
    ]
    expect(filterEntries(entries, 'read')).toEqual([{ key: 'a', label: 'Read:*' }])
    expect(filterEntries(entries, '')).toEqual(entries)
    expect(filterEntries(entries, '   ')).toEqual(entries)
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

  it('buildListItems tolerates missing rule arrays in malformed permissions', () => {
    const malformed = { allow: undefined, ask: [], deny: [], workspace: { additionalDirectories: [] }, warnings: [] } as any
    const items = buildListItems({ tab: 'allow', permissions: malformed, searchQuery: '' })
    expect(items).toEqual([{ type: 'add', key: 'add', label: 'Add a new rule...' }])
  })

  it('formatWorkspaceSourceLabel maps session and non-session entries', () => {
    expect(
      formatWorkspaceSourceLabel({
        dir: '/tmp/a',
        scope: 'projectLocal',
        filePath: '(session)',
      } as WorkspaceDirectoryEntry),
    ).toBe('session')
    expect(
      formatWorkspaceSourceLabel({
        dir: '/tmp/a',
        scope: 'project',
        filePath: '/tmp/project/.formax/settings.json',
      } as WorkspaceDirectoryEntry),
    ).toBe('project settings')
  })

  it('persistWorkspaceDirFromInput persists only non-empty trimmed input', async () => {
    const persist = vi.fn<(dir: string) => Promise<void>>(async () => {})
    await persistWorkspaceDirFromInput('   ', persist)
    expect(persist).toHaveBeenCalledTimes(0)
    await persistWorkspaceDirFromInput('  /tmp/x  ', persist)
    expect(persist).toHaveBeenCalledWith('/tmp/x')
  })
})
