import path from 'node:path'
import type { FileStore } from '../fs/fileStore.js'
import { getConfigPaths, type Platform } from '../fs/configPaths.js'
import { resolveFormaxProjectRoot } from '../fs/projectRoot.js'
import { addWorkspaceSessionDirectory, deleteWorkspaceSessionDirectory, listWorkspaceSessionDirectories } from './workspaceSession.js'

export type PermissionsAllowList = {
  version: 1
  permissions: {
    allow: string[]
  }
}

export type PermissionScope = 'projectLocal' | 'project' | 'user'
export type PermissionListKind = 'allow' | 'ask' | 'deny'

export type PermissionsSettings = {
  version: 1
  permissions: {
    allow: string[]
    ask: string[]
    deny: string[]
    workspace: { additionalDirectories: string[] }
  }
}

export type PermissionRuleEntry = {
  rule: string
  scope: PermissionScope
  filePath: string
}

export type WorkspaceDirectoryEntry = {
  dir: string
  scope: PermissionScope
  filePath: string
}

export type LoadedPermissions = {
  allow: PermissionRuleEntry[]
  ask: PermissionRuleEntry[]
  deny: PermissionRuleEntry[]
  workspace: { additionalDirectories: WorkspaceDirectoryEntry[] }
  warnings: string[]
}

export function getProjectSettingsLocalPath(cwd: string): string {
  const projectRoot = resolveFormaxProjectRoot(cwd)
  return path.join(projectRoot, '.formax', 'settings.local.json')
}

export function getProjectSettingsPath(cwd: string): string {
  const projectRoot = resolveFormaxProjectRoot(cwd)
  return path.join(projectRoot, '.formax', 'settings.json')
}

export function getUserSettingsPath(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): string {
  const paths = getConfigPaths({ cwd: args.cwd, env: args.env, platform: args.platform, homedir: args.homedir })
  return path.join(paths.globalConfigDir, 'settings.json')
}

function parsePermissionList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => String(v)).map((v) => v.trim()).filter(Boolean)
}

function parseWorkspaceAdditionalDirectories(raw: unknown): string[] {
  const dirs = (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any).additionalDirectories : null) as unknown
  return parsePermissionList(dirs)
}

function tryParseSettingsJson(raw: string): Record<string, unknown> | null {
  const text = String(raw).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

type ParsedPermissionsFromFile = {
  settings: Record<string, unknown> | null
  allow: string[]
  ask: string[]
  deny: string[]
  workspaceAdditionalDirectories: string[]
  warning?: string
}

async function loadSettingsPermissions(args: {
  fileStore: FileStore
  filePath: string
  scopeLabel: string
}): Promise<ParsedPermissionsFromFile> {
  if (!(await args.fileStore.exists(args.filePath))) {
    return { settings: null, allow: [], ask: [], deny: [], workspaceAdditionalDirectories: [] }
  }

  try {
    const raw = await args.fileStore.readText(args.filePath)
    const settings = tryParseSettingsJson(raw)
    if (!settings) {
      return {
        settings: null,
        allow: [],
        ask: [],
        deny: [],
        workspaceAdditionalDirectories: [],
        warning: `Invalid JSON in ${args.scopeLabel} settings (${args.filePath}); treating as empty`,
      }
    }

    const permissions =
      typeof settings.permissions === 'object' && settings.permissions && !Array.isArray(settings.permissions)
        ? (settings.permissions as Record<string, unknown>)
        : null

    return {
      settings,
      allow: parsePermissionList(permissions?.allow),
      ask: parsePermissionList(permissions?.ask),
      deny: parsePermissionList(permissions?.deny),
      workspaceAdditionalDirectories: parseWorkspaceAdditionalDirectories(permissions?.workspace),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      settings: null,
      allow: [],
      ask: [],
      deny: [],
      workspaceAdditionalDirectories: [],
      warning: `Failed to read ${args.scopeLabel} settings (${args.filePath}): ${msg}`,
    }
  }
}

function dedupeByPriority<T>(entries: T[], getKey: (t: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const e of entries) {
    const key = getKey(e).trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

export async function loadMergedPermissions(args: {
  fileStore: FileStore
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<LoadedPermissions> {
  const cwd = args.cwd
  const projectRoot = resolveFormaxProjectRoot(cwd)
  const filePaths = {
    projectLocal: getProjectSettingsLocalPath(cwd),
    project: getProjectSettingsPath(cwd),
    user: getUserSettingsPath({ cwd, env: args.env, platform: args.platform, homedir: args.homedir }),
  } satisfies Record<PermissionScope, string>

  // Priority: projectLocal > project > user
  const sources: Array<{ scope: PermissionScope; filePath: string }> = [
    { scope: 'projectLocal', filePath: filePaths.projectLocal },
    { scope: 'project', filePath: filePaths.project },
    { scope: 'user', filePath: filePaths.user },
  ]

  const warnings: string[] = []
  const parsedByScope: Record<PermissionScope, ParsedPermissionsFromFile> = {
    projectLocal: await loadSettingsPermissions({ fileStore: args.fileStore, filePath: filePaths.projectLocal, scopeLabel: 'project local' }),
    project: await loadSettingsPermissions({ fileStore: args.fileStore, filePath: filePaths.project, scopeLabel: 'project' }),
    user: await loadSettingsPermissions({ fileStore: args.fileStore, filePath: filePaths.user, scopeLabel: 'user' }),
  }

  for (const scope of Object.keys(parsedByScope) as PermissionScope[]) {
    const w = parsedByScope[scope].warning
    if (w) warnings.push(w)
  }

  const allow = dedupeByPriority(
    sources.flatMap(({ scope, filePath }) => parsedByScope[scope].allow.map((rule) => ({ rule, scope, filePath }))),
    (e) => e.rule,
  )
  const ask = dedupeByPriority(
    sources.flatMap(({ scope, filePath }) => parsedByScope[scope].ask.map((rule) => ({ rule, scope, filePath }))),
    (e) => e.rule,
  )
  const deny = dedupeByPriority(
    sources.flatMap(({ scope, filePath }) => parsedByScope[scope].deny.map((rule) => ({ rule, scope, filePath }))),
    (e) => e.rule,
  )

  const workspaceAdditionalDirectories = dedupeByPriority(
    sources.flatMap(({ scope, filePath }) =>
      parsedByScope[scope].workspaceAdditionalDirectories.map((dir) => ({ dir, scope, filePath })),
    ),
    (e) => e.dir,
  )

  // Workspace directories are session-only (not persisted). Claude Code appears to
  // treat workspace additions as ephemeral to the current session by default.
  //
  // We still parse the on-disk `permissions.workspace.additionalDirectories` field,
  // but do not include it in the effective workspace roots. This keeps the
  // permissions schema forward-compatible while aligning runtime behavior.
  //
  // NOTE: If we later add an explicit "persist workspace" choice, we can re-enable
  // `workspaceAdditionalDirectories` here behind that option.
  void workspaceAdditionalDirectories

  const sessionDirs = listWorkspaceSessionDirectories(projectRoot)
  const sessionEntries: WorkspaceDirectoryEntry[] = sessionDirs.map((e) => ({
    dir: e.dir,
    scope: 'projectLocal',
    filePath: '(session)',
  }))

  return { allow, ask, deny, workspace: { additionalDirectories: sessionEntries }, warnings }
}

async function loadSettingsRecord(args: { fileStore: FileStore; filePath: string }): Promise<Record<string, unknown> | null> {
  if (!(await args.fileStore.exists(args.filePath))) return null
  try {
    return tryParseSettingsJson(await args.fileStore.readText(args.filePath))
  } catch {
    return null
  }
}

function getOrInitPermissions(settings: Record<string, unknown> | null): Record<string, unknown> {
  const existing =
    settings && typeof settings.permissions === 'object' && settings.permissions && !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : null
  return { ...(existing ?? {}) }
}

function readListFromPermissions(permissions: Record<string, unknown>, kind: PermissionListKind): string[] {
  return parsePermissionList((permissions as any)[kind])
}

function writePermissionsSettings(args: {
  existingSettings: Record<string, unknown> | null
  permissions: Record<string, unknown>
}): Record<string, unknown> {
  return {
    ...(args.existingSettings ?? {}),
    version: 1,
    permissions: args.permissions,
  }
}

function getSettingsPathForScope(args: {
  scope: PermissionScope
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): string {
  if (args.scope === 'projectLocal') return getProjectSettingsLocalPath(args.cwd)
  if (args.scope === 'project') return getProjectSettingsPath(args.cwd)
  return getUserSettingsPath({ cwd: args.cwd, env: args.env, platform: args.platform, homedir: args.homedir })
}

export async function persistPermissionRule(args: {
  fileStore: FileStore
  cwd: string
  scope: PermissionScope
  kind: PermissionListKind
  rule: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const cwd = args.cwd
  const filePath = getSettingsPathForScope({ scope: args.scope, cwd, env: args.env, platform: args.platform, homedir: args.homedir })
  const rule = String(args.rule).trim()
  if (!rule) return

  const existingSettings = await loadSettingsRecord({ fileStore: args.fileStore, filePath })
  const permissions = getOrInitPermissions(existingSettings)

  const existing = readListFromPermissions(permissions, args.kind)
  if (existing.includes(rule)) return

  const next = Array.from(new Set([...existing, rule])).sort((a, b) => a.localeCompare(b))
  permissions[args.kind] = next

  const out = writePermissionsSettings({ existingSettings, permissions })
  await args.fileStore.writeJsonAtomic(filePath, out, { pretty: true, trailingNewline: true })
}

export async function deletePermissionRule(args: {
  fileStore: FileStore
  cwd: string
  scope: PermissionScope
  kind: PermissionListKind
  rule: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const cwd = args.cwd
  const filePath = getSettingsPathForScope({ scope: args.scope, cwd, env: args.env, platform: args.platform, homedir: args.homedir })
  const rule = String(args.rule).trim()
  if (!rule) return

  const existingSettings = await loadSettingsRecord({ fileStore: args.fileStore, filePath })
  if (!existingSettings) return
  const permissions = getOrInitPermissions(existingSettings)
  const existing = readListFromPermissions(permissions, args.kind)
  const next = existing.filter((r) => r !== rule)
  if (next.length === existing.length) return
  permissions[args.kind] = next

  const out = writePermissionsSettings({ existingSettings, permissions })
  await args.fileStore.writeJsonAtomic(filePath, out, { pretty: true, trailingNewline: true })
}

export async function persistWorkspaceDirectory(args: {
  fileStore: FileStore
  cwd: string
  scope: PermissionScope
  dir: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const dir = String(args.dir).trim()
  if (!dir) return
  const projectRoot = resolveFormaxProjectRoot(args.cwd)
  addWorkspaceSessionDirectory(projectRoot, dir)
}

export async function deleteWorkspaceDirectory(args: {
  fileStore: FileStore
  cwd: string
  scope: PermissionScope
  dir: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const dir = String(args.dir).trim()
  if (!dir) return
  const projectRoot = resolveFormaxProjectRoot(args.cwd)
  deleteWorkspaceSessionDirectory(projectRoot, dir)
}

export async function loadProjectPermissionsAllowList(args: {
  fileStore: FileStore
  cwd: string
}): Promise<Set<string>> {
  const merged = await loadMergedPermissions({ fileStore: args.fileStore, cwd: args.cwd })
  return new Set(merged.allow.map((e) => e.rule))
}

export async function persistProjectPermissionAllow(args: {
  fileStore: FileStore
  cwd: string
  key: string
}): Promise<void> {
  await persistPermissionRule({
    fileStore: args.fileStore,
    cwd: args.cwd,
    scope: 'projectLocal',
    kind: 'allow',
    rule: args.key,
  })
}
