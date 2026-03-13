import type { FileStore } from '../../adapters/fs/fileStore.js'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import {
  deletePermissionRule,
  deleteWorkspaceDirectory,
  loadMergedPermissions,
  persistPermissionRule,
  persistWorkspaceDirectory,
  type LoadedPermissions,
  type PermissionListKind,
  type PermissionRuleEntry,
  type PermissionScope,
  type WorkspaceDirectoryEntry,
} from '../../adapters/permissions/permissionsStore.js'

export type {
  LoadedPermissions,
  PermissionListKind,
  PermissionRuleEntry,
  PermissionScope,
  WorkspaceDirectoryEntry,
}

export type PermissionsDialogService = {
  load: () => Promise<LoadedPermissions>
  persistRule: (args: { scope: PermissionScope; kind: PermissionListKind; rule: string }) => Promise<void>
  deleteRule: (args: { scope: PermissionScope; kind: PermissionListKind; rule: string }) => Promise<void>
  persistWorkspaceDir: (args: { scope: PermissionScope; dir: string }) => Promise<void>
  deleteWorkspaceDir: (args: { scope: PermissionScope; dir: string }) => Promise<void>
}

export function createPermissionsDialogService(args?: {
  fileStore?: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): PermissionsDialogService {
  const fileStore = args?.fileStore ?? createNodeFileStore()
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const platform = args?.platform
  const homedir = args?.homedir

  return {
    load: () =>
      loadMergedPermissions({
        fileStore,
        cwd,
        env,
        platform,
        homedir,
      }),
    persistRule: ({ scope, kind, rule }) =>
      persistPermissionRule({
        fileStore,
        cwd,
        scope,
        kind,
        rule,
        env,
        platform,
        homedir,
      }),
    deleteRule: ({ scope, kind, rule }) =>
      deletePermissionRule({
        fileStore,
        cwd,
        scope,
        kind,
        rule,
        env,
        platform,
        homedir,
      }),
    persistWorkspaceDir: ({ scope, dir }) =>
      persistWorkspaceDirectory({
        fileStore,
        cwd,
        scope,
        dir,
        env,
        platform,
        homedir,
      }),
    deleteWorkspaceDir: ({ scope, dir }) =>
      deleteWorkspaceDirectory({
        fileStore,
        cwd,
        scope,
        dir,
        env,
        platform,
        homedir,
      }),
  }
}
