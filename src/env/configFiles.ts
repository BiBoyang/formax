import type { FileStore } from '../core/config/fileStore.js'
import type { Platform } from '../core/config/paths.js'
import { loadConfigFiles as loadConfigFilesWithPaths } from '../core/config/configFiles.js'
import { getConfigPaths } from './configPaths.js'

export async function loadConfigFiles(args: {
  fileStore: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}) {
  const paths = getConfigPaths(args)
  return loadConfigFilesWithPaths({ ...args, paths })
}
