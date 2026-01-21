import path from 'node:path'
import type {
  LoadedPermissions,
  PermissionListKind,
  PermissionRuleEntry,
  WorkspaceDirectoryEntry,
} from '../../adapters/permissions/permissionsStore.js'
import type { PermissionTab } from './constants.js'

export function formatScopeLabel(scope: 'projectLocal' | 'project' | 'user'): string {
  switch (scope) {
    case 'projectLocal':
      return 'project local settings'
    case 'project':
      return 'project settings'
    case 'user':
      return 'user settings'
    default:
      return 'settings'
  }
}

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

export function nextTab(current: PermissionTab, dir: 1 | -1): PermissionTab {
  const tabs: PermissionTab[] = ['allow', 'ask', 'deny', 'workspace']
  const idx = tabs.indexOf(current)
  const start = idx >= 0 ? idx : 0
  const next = (start + dir + tabs.length) % tabs.length
  return tabs[next]!
}

export function getListKind(tab: PermissionTab): PermissionListKind | null {
  if (tab === 'workspace') return null
  return tab
}

export function formatWorkspaceDirLabel(dir: string): string {
  const raw = String(dir || '').trim()
  if (!raw) return ''
  // Prefer the basename for readability; tests assert on the basename.
  const base = path.basename(raw)
  return base || raw
}

export function filterEntries<T extends { key: string; label: string }>(entries: T[], query: string): T[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => e.label.toLowerCase().includes(q))
}

export type PermissionsListItem =
  | { type: 'add'; key: string; label: string }
  | { type: 'rule'; key: string; label: string; kind: PermissionListKind; entry: PermissionRuleEntry }
  | { type: 'dir'; key: string; label: string; entry: WorkspaceDirectoryEntry }

export function buildListItems(args: {
  tab: PermissionTab
  permissions: LoadedPermissions
  searchQuery: string
}): PermissionsListItem[] {
  if (args.tab === 'workspace') {
    const dirs: PermissionsListItem[] = args.permissions.workspace.additionalDirectories.map((entry) => ({
      type: 'dir',
      key: `dir:${entry.scope}:${entry.dir}`,
      label: formatWorkspaceDirLabel(entry.dir),
      entry,
    }))
    const filtered = filterEntries(dirs, args.searchQuery)
    return [{ type: 'add', key: 'add', label: 'Add directory' }, ...filtered]
  }

  const kind = args.tab
  const list = (args.permissions as any)[kind] as PermissionRuleEntry[]
  const rules: PermissionsListItem[] = (list ?? []).map((entry) => ({
    type: 'rule',
    key: `rule:${entry.scope}:${entry.rule}`,
    label: String(entry.rule),
    kind,
    entry,
  }))
  const filtered = filterEntries(rules, args.searchQuery)
  return [{ type: 'add', key: 'add', label: 'Add a new rule...' }, ...filtered]
}
