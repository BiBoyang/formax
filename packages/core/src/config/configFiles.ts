import type { FileStore } from '../config/settings/fileStore.js'
import type { Platform } from '../config/settings/paths.js'
import { loadConfigFiles as loadConfigFilesWithPaths } from '../config/settings/configFiles.js'
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
