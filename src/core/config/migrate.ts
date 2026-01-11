import type { FileMode, FileStore } from '../../adapters/fs/fileStore.js'
import type { ConfigPaths, Platform } from '../../adapters/fs/configPaths.js'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'

const AUTH_FILE_MODE: FileMode = 0o600

export type ConfigMigrateActionStatus = 'copied' | 'skipped' | 'missing' | 'error'

export type ConfigMigrateAction = {
  label: 'config' | 'auth' | 'rules'
  fromPath: string
  toPath: string
  status: ConfigMigrateActionStatus
  error?: string
}

export type ConfigMigrateResult = {
  paths: ConfigPaths
  actions: ConfigMigrateAction[]
  warnings: string[]
}

async function migrateFile(args: {
  fileStore: FileStore
  label: ConfigMigrateAction['label']
  fromPath: string
  toPath: string
  mode?: FileMode
  warnings: string[]
}): Promise<ConfigMigrateAction> {
  const fromExists = await args.fileStore.exists(args.fromPath)
  if (!fromExists) return { label: args.label, fromPath: args.fromPath, toPath: args.toPath, status: 'missing' }

  const toExists = await args.fileStore.exists(args.toPath)
  if (toExists) return { label: args.label, fromPath: args.fromPath, toPath: args.toPath, status: 'skipped' }

  let content = ''
  try {
    content = await args.fileStore.readText(args.fromPath)
  } catch (err) {
    args.warnings.push(`Failed to read legacy ${args.label} at ${args.fromPath}`)
    return {
      label: args.label,
      fromPath: args.fromPath,
      toPath: args.toPath,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }

  try {
    await args.fileStore.writeTextAtomic(args.toPath, content, args.mode ? { mode: args.mode } : undefined)
  } catch (err) {
    args.warnings.push(`Failed to write ${args.label} to ${args.toPath}`)
    return {
      label: args.label,
      fromPath: args.fromPath,
      toPath: args.toPath,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }

  return { label: args.label, fromPath: args.fromPath, toPath: args.toPath, status: 'copied' }
}

export async function configMigrate(args: {
  fileStore: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<ConfigMigrateResult> {
  const paths = getConfigPaths(args)
  const warnings: string[] = []

  if (paths.legacyConfigDir === paths.globalConfigDir) {
    return { paths, actions: [], warnings }
  }

  const actions = [
    await migrateFile({
      fileStore: args.fileStore,
      label: 'config',
      fromPath: paths.legacyConfigPath,
      toPath: paths.globalConfigPath,
      warnings,
    }),
    await migrateFile({
      fileStore: args.fileStore,
      label: 'auth',
      fromPath: paths.legacyAuthPath,
      toPath: paths.globalAuthPath,
      mode: AUTH_FILE_MODE,
      warnings,
    }),
    await migrateFile({
      fileStore: args.fileStore,
      label: 'rules',
      fromPath: paths.legacyRulesPath,
      toPath: paths.globalRulesPath,
      warnings,
    }),
  ]

  return { paths, actions, warnings }
}

