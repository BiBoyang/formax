import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileStore } from '../fs/fileStore.js'
import type { Platform } from '../fs/configPaths.js'
import { getConfigPaths } from '../fs/configPaths.js'
import { authSet } from '../../core/auth/index.js'
import { FormaxConfigV1PatchSchema, FormaxConfigV1Schema } from '../../core/config/schema.js'
import type { ProviderId, TierModelMapping } from '../../core/config/schema.js'

export type WriteSetupFilesResult = {
  configPath: string
  authPath: string
  logsDir: string
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

function mergeConfigPatches(
  base: unknown,
  next: unknown,
  warnings: string[],
): Record<string, unknown> {
  const baseParsed = FormaxConfigV1PatchSchema.safeParse(base ?? {})
  const nextParsed = FormaxConfigV1PatchSchema.safeParse(next ?? {})
  if (!baseParsed.success && base) warnings.push('Existing config is invalid and was ignored')
  if (!nextParsed.success && next) warnings.push('New config is invalid and was ignored')

  const b = baseParsed.success ? baseParsed.data : {}
  const n = nextParsed.success ? nextParsed.data : {}

  return {
    ...b,
    ...n,
    llm: { ...(b.llm || {}), ...(n.llm || {}) },
    paths: { ...(b.paths || {}), ...(n.paths || {}) },
    ui: { ...(b.ui || {}), ...(n.ui || {}) },
  }
}

export async function writeSetupFiles(args: {
  fileStore: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  tierModels?: TierModelMapping
  authRef?: string
}): Promise<WriteSetupFilesResult> {
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir

  const warnings: string[] = []
  const paths = getConfigPaths({ cwd, env, platform, homedir })

  const configPath = paths.globalConfigPath
  const authPath = paths.globalAuthPath
  const authRef = (args.authRef || 'default').trim() || 'default'
  const logsDir = path.join(paths.globalConfigDir, 'logs')

  const existing = await readJsonIfExists(args.fileStore, configPath, 'config', warnings)
  const tierModels = args.tierModels
  const modelFromTier = tierModels?.sonnet?.trim() || ''
  const resolvedModel = args.model.trim() || modelFromTier
  const nextPatch = {
    version: 1,
    llm: {
      provider: args.provider,
      baseUrl: args.baseUrl,
      model: resolvedModel,
      ...(tierModels ? { tierModels } : {}),
      authRef,
    },
    paths: { logsDir },
  }
  const merged = mergeConfigPatches(existing, nextPatch, warnings)
  const validated = FormaxConfigV1Schema.safeParse(merged)
  if (!validated.success) {
    throw new Error('Failed to write config: invalid config data')
  }
  await args.fileStore.writeJsonAtomic(configPath, validated.data)

  const authRes = await authSet({
    fileStore: args.fileStore,
    authPath,
    provider: args.provider,
    authRef,
    apiKey: args.apiKey,
  })
  warnings.push(...authRes.warnings)

  await fs.mkdir(logsDir, { recursive: true })

  return { configPath, authPath, logsDir, warnings }
}
