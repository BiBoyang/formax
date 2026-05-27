import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileStore } from '../fs/fileStore.js'
import type { Platform } from '../fs/configPaths.js'
import { getConfigPaths } from '../fs/configPaths.js'
import { authSet } from '../../core/auth/index.js'
import { FormaxConfigV1PatchSchema, FormaxConfigV1Schema } from '../../config/settings/schema.js'
import { shouldPersistContextWindowSource } from '../../core/models/modelCapability.js'
import type {
  CapabilitySource,
  ProviderId,
  TierContextWindowBindingMapping,
  TierContextWindowConfidenceMapping,
  TierContextWindowMapping,
  TierContextWindowSourceMapping,
  TierModelMapping,
} from '../../config/settings/schema.js'

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
  const nextParsed = FormaxConfigV1PatchSchema.safeParse(next)
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

function filterPersistableTierContextWindowTokens(args: {
  tokens?: TierContextWindowMapping
  sources?: TierContextWindowSourceMapping
}): TierContextWindowMapping | undefined {
  if (!args.tokens) return undefined
  if (!args.sources) return args.tokens
  const out: TierContextWindowMapping = {}
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const source = args.sources[tier]
    const tokens = args.tokens[tier]
    if (tokens == null) continue
    if (!source || !shouldPersistContextWindowSource(source)) continue
    out[tier] = tokens
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function filterPersistableTierMetadata<T extends TierContextWindowSourceMapping | TierContextWindowConfidenceMapping | TierContextWindowBindingMapping>(args: {
  values?: T
  sources?: TierContextWindowSourceMapping
}): T | undefined {
  if (!args.values) return undefined
  if (!args.sources) return args.values
  const out: Record<string, unknown> = {}
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const source = args.sources[tier]
    const value = args.values[tier]
    if (value == null) continue
    if (source && !shouldPersistContextWindowSource(source)) continue
    out[tier] = value
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined
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
  persistApiKey?: boolean
  model: string
  tierModels?: TierModelMapping
  tierContextWindowTokens?: TierContextWindowMapping
  tierContextWindowSources?: TierContextWindowSourceMapping
  tierContextWindowConfidence?: TierContextWindowConfidenceMapping
  tierContextWindowBindings?: TierContextWindowBindingMapping
  contextWindowTokens?: number
  contextWindowSource?: CapabilitySource
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
  const tierContextWindowSources = filterPersistableTierMetadata({
    values: args.tierContextWindowSources,
    sources: args.tierContextWindowSources,
  })
  const tierContextWindowTokens = filterPersistableTierContextWindowTokens({
    tokens: args.tierContextWindowTokens,
    sources: args.tierContextWindowSources,
  })
  const tierContextWindowConfidence = filterPersistableTierMetadata({
    values: args.tierContextWindowConfidence,
    sources: args.tierContextWindowSources,
  })
  const tierContextWindowBindings = filterPersistableTierMetadata({
    values: args.tierContextWindowBindings,
    sources: args.tierContextWindowSources,
  })
  const modelFromTier = tierModels?.sonnet?.trim() || ''
  const resolvedModel = args.model.trim() || modelFromTier
  const nextPatch = {
    version: 1,
    llm: {
      provider: args.provider,
      baseUrl: args.baseUrl,
      model: resolvedModel,
      ...(tierModels ? { tierModels } : {}),
      ...(tierContextWindowTokens ? { tierContextWindowTokens } : {}),
      ...(tierContextWindowSources ? { tierContextWindowSources } : {}),
      ...(tierContextWindowConfidence ? { tierContextWindowConfidence } : {}),
      ...(tierContextWindowBindings ? { tierContextWindowBindings } : {}),
      ...(args.contextWindowSource !== 'heuristic' &&
      Number.isFinite(args.contextWindowTokens) &&
      (args.contextWindowTokens || 0) > 0
        ? { contextWindowTokens: Math.round(args.contextWindowTokens as number) }
        : {}),
      authRef,
    },
    paths: { logsDir },
  }
  const merged = mergeConfigPatches(existing, nextPatch, warnings)
  const mergedLlm =
    merged.llm && typeof merged.llm === 'object' ? (merged.llm as Record<string, unknown>) : ((merged.llm = {}), merged.llm as Record<string, unknown>)
  if (args.contextWindowSource === 'heuristic') {
    delete mergedLlm.contextWindowTokens
  }
  const hasTierContextWindowInputs =
    args.tierContextWindowTokens !== undefined ||
    args.tierContextWindowSources !== undefined ||
    args.tierContextWindowConfidence !== undefined ||
    args.tierContextWindowBindings !== undefined
  if (hasTierContextWindowInputs) {
    if (tierContextWindowTokens) mergedLlm.tierContextWindowTokens = tierContextWindowTokens
    else delete mergedLlm.tierContextWindowTokens
    if (tierContextWindowSources) mergedLlm.tierContextWindowSources = tierContextWindowSources
    else delete mergedLlm.tierContextWindowSources
    if (tierContextWindowConfidence) mergedLlm.tierContextWindowConfidence = tierContextWindowConfidence
    else delete mergedLlm.tierContextWindowConfidence
    if (tierContextWindowBindings) mergedLlm.tierContextWindowBindings = tierContextWindowBindings
    else delete mergedLlm.tierContextWindowBindings
  }
  const validated = FormaxConfigV1Schema.parse(merged)
  await args.fileStore.writeJsonAtomic(configPath, validated)

  if (args.persistApiKey !== false) {
    const authRes = await authSet({
      fileStore: args.fileStore,
      authPath,
      provider: args.provider,
      authRef,
      apiKey: args.apiKey,
    })
    warnings.push(...authRes.warnings)
  }

  await fs.mkdir(logsDir, { recursive: true })

  return { configPath, authPath, logsDir, warnings }
}
