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

  legacyConfigPath: string
  legacyAuthPath: string
  legacyRulesPath: string

  projectConfigPath: string
  projectRulesPath: string
}

function expandLeadingTilde(inputPath: string, homedir: string): string {
  const raw = String(inputPath).trim()
  if (raw === '~') return homedir
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homedir, raw.slice(2))
  return raw
}

function getDefaultGlobalConfigDir(env: NodeJS.ProcessEnv, homedir: string): string {
  const rawOverride = String(env.FORMAX_CONFIG_DIR || '').trim()
  // Defensive: some shells/CI setups accidentally set env vars to the literal string "undefined".
  // Treat that as unset to avoid creating config dirs like "<cwd>/undefined/".
  if (rawOverride && rawOverride !== 'undefined' && rawOverride !== 'null') {
    return expandLeadingTilde(rawOverride, homedir)
  }
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
    legacyConfigPath: path.join(legacyConfigDir, 'config.json'),
    legacyAuthPath: path.join(legacyConfigDir, 'auth.json'),
    legacyRulesPath: path.join(legacyConfigDir, 'rules.json'),
    projectConfigPath: path.join(projectConfigDir, 'config.json'),
    projectRulesPath: path.join(projectConfigDir, 'rules.json'),
  }
}
