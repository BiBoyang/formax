import type { FileStore } from './fileStore.js'
import type { ConfigPaths } from './paths.js'

export type LoadedConfigFiles = {
  paths: ConfigPaths
  globalConfig: unknown | null
  projectConfig: unknown | null
  authStore: unknown | null
  globalRules: unknown | null
  projectRules: unknown | null
  warnings: string[]
}

async function readJsonIfExists(
  fileStore: FileStore,
  filePath: string,
  label: string,
  warnings: string[],
): Promise<unknown | null> {
  const exists = await fileStore.exists(filePath)
  if (!exists) return null

  let text = ''
  try {
    text = await fileStore.readText(filePath)
  } catch {
    warnings.push(`Failed to read ${label} at ${filePath}`)
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    warnings.push(`Failed to parse ${label} JSON at ${filePath}`)
    return null
  }
}

export async function loadConfigFiles(args: {
  fileStore: FileStore
  paths: ConfigPaths
  cwd?: string
  env?: NodeJS.ProcessEnv
  homedir?: string
}): Promise<LoadedConfigFiles> {
  const paths = args.paths
  const warnings: string[] = []

  const globalConfig = await readJsonIfExists(args.fileStore, paths.globalConfigPath, 'global config', warnings)
  const projectConfig = await readJsonIfExists(args.fileStore, paths.projectConfigPath, 'project config', warnings)
  const authStore = await readJsonIfExists(args.fileStore, paths.globalAuthPath, 'auth store', warnings)
  const globalRules = await readJsonIfExists(args.fileStore, paths.globalRulesPath, 'global rules', warnings)
  const projectRules = await readJsonIfExists(args.fileStore, paths.projectRulesPath, 'project rules', warnings)

  return { paths, globalConfig, projectConfig, authStore, globalRules, projectRules, warnings }
}
