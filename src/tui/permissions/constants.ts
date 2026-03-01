export type PermissionTab = 'allow' | 'ask' | 'deny' | 'workspace'

export const PERMISSION_TABS: Array<{ key: PermissionTab; label: string }> = [
  { key: 'allow', label: 'Allow' },
  { key: 'ask', label: 'Ask' },
  { key: 'deny', label: 'Deny' },
  { key: 'workspace', label: 'Workspace' },
]

export type SaveScope = 'projectLocal' | 'project' | 'user'

export const SAVE_SCOPE_OPTIONS: Array<{ scope: SaveScope; label: string }> = [
  { scope: 'projectLocal', label: 'Project local (.formax/settings.local.json)' },
  { scope: 'project', label: 'Project (.formax/settings.json)' },
  { scope: 'user', label: 'User (~/.formax/settings.json)' },
]

