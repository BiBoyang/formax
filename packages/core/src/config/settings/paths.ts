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
