import path from 'node:path'
import os from 'node:os'

export type Platform = 'win32' | 'darwin' | 'linux' | string

export type ConfigPaths = {
  globalConfigDir: string
  legacyConfigDir: string
  projectConfigDir: string

  globalConfigPath: string
  globalAuthPath: string
  globalRulesPath: string

  projectConfigPath: string
  projectRulesPath: string
}

function getDefaultGlobalConfigDir(env: NodeJS.ProcessEnv, homedir: string): string {
  if (env.FORMAX_CONFIG_DIR) return env.FORMAX_CONFIG_DIR
  return path.join(homedir, '.formax')
}

function getLegacyConfigDir(platform: Platform, env: NodeJS.ProcessEnv, homedir: string): string {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming')
    return path.join(appData, 'formax')
  }

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'formax')
  }

  const xdg = env.XDG_CONFIG_HOME || path.join(homedir, '.config')
  return path.join(xdg, 'formax')
}

export function getConfigPaths(args: { cwd?: string; env?: NodeJS.ProcessEnv; platform?: Platform; homedir?: string }): ConfigPaths {
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir ?? os.homedir()

  const globalConfigDir = getDefaultGlobalConfigDir(env, homedir)
  const legacyConfigDir = getLegacyConfigDir(platform, env, homedir)
  const projectConfigDir = path.join(cwd, '.formax')

  return {
    globalConfigDir,
    legacyConfigDir,
    projectConfigDir,
    globalConfigPath: path.join(globalConfigDir, 'config.json'),
    globalAuthPath: path.join(globalConfigDir, 'auth.json'),
    globalRulesPath: path.join(globalConfigDir, 'rules.json'),
    projectConfigPath: path.join(projectConfigDir, 'config.json'),
    projectRulesPath: path.join(projectConfigDir, 'rules.json'),
  }
}
