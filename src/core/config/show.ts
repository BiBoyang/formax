import type { FileStore } from './fileStore.js'
import type { ConfigPaths, Platform } from './paths.js'
import { loadConfigFiles } from './configFiles.js'
import type { ConfigSource } from './resolve.js'
import { resolveRuntimeConfig } from './resolve.js'
import type { FormaxConfigV1, ProviderId } from './schema.js'

export type ConfigShowAuth = {
  provider: ProviderId
  source: ConfigSource
  authRef: string
} | null

export type ConfigShowFiles = {
  globalConfigLoaded: boolean
  projectConfigLoaded: boolean
  authStoreLoaded: boolean
  globalRulesLoaded: boolean
  projectRulesLoaded: boolean
}

export type ConfigShowResult = {
  paths: ConfigPaths
  files: ConfigShowFiles
  config: FormaxConfigV1
  sources: Record<string, ConfigSource>
  auth: ConfigShowAuth
  warnings: string[]
}

function redactAuth(args: { provider: ProviderId; authRef: string; source: ConfigSource } | null): ConfigShowAuth {
  if (!args) return null
  return { provider: args.provider, source: args.source, authRef: args.authRef }
}

export async function configShow(args: {
  fileStore: FileStore
  paths: ConfigPaths
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<ConfigShowResult> {
  const disk = await loadConfigFiles(args)

  const resolved = resolveRuntimeConfig({
    globalConfig: disk.globalConfig,
    projectConfig: disk.projectConfig,
    authStore: disk.authStore,
    env: (args.env ?? process.env) as Record<string, string | undefined>,
  })

  const warnings = [...disk.warnings, ...resolved.warnings]
  const auth = redactAuth(
    resolved.auth
      ? { provider: resolved.auth.provider, authRef: resolved.config.llm.authRef, source: resolved.auth.source }
      : null,
  )

  return {
    paths: disk.paths,
    files: {
      globalConfigLoaded: disk.globalConfig !== null,
      projectConfigLoaded: disk.projectConfig !== null,
      authStoreLoaded: disk.authStore !== null,
      globalRulesLoaded: disk.globalRules !== null,
      projectRulesLoaded: disk.projectRules !== null,
    },
    config: resolved.config,
    sources: resolved.sources,
    auth,
    warnings,
  }
}
