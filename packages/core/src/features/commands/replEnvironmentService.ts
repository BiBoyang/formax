import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots, type WorkspaceRootsResult } from '../../adapters/fs/workspaceRoots'
import { loadRuntimeConfig } from '../../config/config'
import { resolveRuntimeModelProfile } from '../../config/runtimeModelProfile'
import { updateConfigPatchFile } from '../../config/settings/persist'
import type { ModelTier } from '../../config/modelTier'
import { normalizeModelIdentity, shouldPersistContextWindowSource } from '../../core/models/modelCapability'
import type {
  CapabilityConfidence,
  CapabilitySource,
  ConfigBudgetSource,
  TierContextWindowBindingMapping,
  TierContextWindowConfidenceMapping,
  TierContextWindowMapping,
  TierContextWindowSourceMapping,
} from '../../config/settings/schema'

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

const CAPABILITY_SOURCES = new Set<CapabilitySource>([
  'provider_list',
  'provider_detail',
  'catalog',
  'heuristic',
  'known_model_map',
])

function isCapabilitySource(source: ConfigBudgetSource | CapabilitySource): source is CapabilitySource {
  return CAPABILITY_SOURCES.has(source as CapabilitySource)
}

function confidenceForSource(source: CapabilitySource): CapabilityConfidence {
  if (source === 'known_model_map') return 'known'
  if (source === 'catalog') return 'catalog'
  if (source === 'heuristic') return 'heuristic'
  return 'detected'
}

function resolveTierContextWindowTokens(args: {
  current?: Partial<Record<ModelTier, number>>
  nextTier: ModelTier
  nextTokens: number
}): TierContextWindowMapping {
  const current = args.current ?? {}
  const next: TierContextWindowMapping = {}
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const currentTokens = toPositiveInt(current[tier])
    if (currentTokens != null) next[tier] = currentTokens
  }
  next[args.nextTier] = args.nextTokens
  return next
}

function resolveTierContextWindowSources(args: {
  current?: TierContextWindowSourceMapping
  nextTier: ModelTier
  nextSource: CapabilitySource
}): TierContextWindowSourceMapping | undefined {
  if (!args.current) return { [args.nextTier]: args.nextSource }
  return {
    ...args.current,
    [args.nextTier]: args.nextSource,
  }
}

function resolveTierContextWindowConfidence(args: {
  current?: TierContextWindowConfidenceMapping
  nextTier: ModelTier
  nextConfidence: CapabilityConfidence
}): TierContextWindowConfidenceMapping | undefined {
  if (!args.current) return { [args.nextTier]: args.nextConfidence }
  return {
    ...args.current,
    [args.nextTier]: args.nextConfidence,
  }
}

function clearTierContextWindowSource(args: {
  current?: TierContextWindowSourceMapping
  nextTier: ModelTier
}): TierContextWindowSourceMapping | undefined {
  if (!args.current) return undefined
  const next = { ...args.current }
  delete next[args.nextTier]
  return Object.keys(next).length > 0 ? next : {}
}

function clearTierContextWindowConfidence(args: {
  current?: TierContextWindowConfidenceMapping
  nextTier: ModelTier
}): TierContextWindowConfidenceMapping | undefined {
  if (!args.current) return undefined
  const next = { ...args.current }
  delete next[args.nextTier]
  return Object.keys(next).length > 0 ? next : {}
}

function clearTierContextWindowBinding(args: {
  current?: TierContextWindowBindingMapping
  nextTier: ModelTier
}): TierContextWindowBindingMapping | undefined {
  if (!args.current) return undefined
  const next = { ...args.current }
  delete next[args.nextTier]
  return Object.keys(next).length > 0 ? next : {}
}

function resolveTierContextWindowBindings(args: {
  current?: TierContextWindowBindingMapping
  provider: 'anthropic' | 'openai' | 'gemini'
  baseUrl: string
  nextTier: ModelTier
  nextBinding: NonNullable<TierContextWindowBindingMapping[ModelTier]>
}): TierContextWindowBindingMapping | undefined {
  if (!args.current) {
    return {
      [args.nextTier]: normalizeModelIdentity({
        provider: args.nextBinding.provider,
        baseUrl: args.nextBinding.baseUrl,
        model: args.nextBinding.model,
      }),
    }
  }
  return {
    ...args.current,
    [args.nextTier]: args.nextBinding,
  }
}

function shouldPersistRuntimeProfile(args: {
  source: ConfigBudgetSource | CapabilitySource
  tokens?: number
}): boolean {
  if (!toPositiveInt(args.tokens)) return false
  if (args.source === 'env_override' || args.source === 'binding_mismatch' || args.source === 'none') return false
  if (isCapabilitySource(args.source)) {
    return shouldPersistContextWindowSource(args.source)
  }
  return true
}

function shouldPersistTierBindingForRuntimeSource(source: ConfigBudgetSource | CapabilitySource): boolean {
  return !(
    source === 'env_override' ||
    source === 'legacy_config' ||
    source === 'migrated_legacy' ||
    source === 'binding_mismatch' ||
    source === 'none'
  )
}

export function resolveUserAgentsDir(args?: {
  cwd?: string
  env?: NodeJS.ProcessEnv
}): string {
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const configPaths = getConfigPaths({ cwd, env })
  const globalConfigDir = path.resolve(cwd, configPaths.globalConfigDir)
  return path.join(globalConfigDir, 'agents')
}

export async function persistDefaultModelTier(args: {
  nextTier: ModelTier
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const store = createNodeFileStore()
  const paths = getConfigPaths({ cwd, env })
  await updateConfigPatchFile({
    fileStore: store,
    filePath: paths.globalConfigPath,
    nextPatch: { llm: { defaultTier: args.nextTier } },
    label: 'llm.defaultTier',
  })

  // Keep context meter aligned with active model after /model changes.
  const runtimeCfg = await loadRuntimeConfig(env, cwd, { fileStore: store })
  const runtimeProfile = resolveRuntimeModelProfile({ cfg: runtimeCfg })
  const activeModel = String(runtimeProfile.model || '').trim()
  if (!activeModel) return
  const effectiveTier = runtimeProfile.activeTier
  if (
    !shouldPersistRuntimeProfile({
      source: runtimeProfile.contextWindowTokensSource,
      tokens: runtimeProfile.contextWindowTokens,
    })
  ) {
    return
  }
  const detectedWindowTokens = toPositiveInt(runtimeProfile.contextWindowTokens)
  if (!detectedWindowTokens) return
  const persistedContextWindowFallback = toPositiveInt(runtimeCfg.llm.contextWindowTokens)
  const nextTierContextWindowTokens = resolveTierContextWindowTokens({
    current: runtimeCfg.llm.tierContextWindowTokens,
    nextTier: effectiveTier,
    nextTokens: detectedWindowTokens ?? persistedContextWindowFallback ?? 32768,
  })
  const nextBinding = normalizeModelIdentity({
    provider: runtimeProfile.provider,
    baseUrl: runtimeProfile.baseUrl,
    model: runtimeProfile.model,
  })
  const nextTierContextWindowBindings = shouldPersistTierBindingForRuntimeSource(runtimeProfile.contextWindowTokensSource)
    ? resolveTierContextWindowBindings({
        current: runtimeCfg.llm.tierContextWindowBindings as TierContextWindowBindingMapping | undefined,
        provider: runtimeProfile.provider,
        baseUrl: runtimeProfile.baseUrl,
        nextTier: effectiveTier,
        nextBinding,
      })
    : clearTierContextWindowBinding({
        current: runtimeCfg.llm.tierContextWindowBindings as TierContextWindowBindingMapping | undefined,
        nextTier: effectiveTier,
      })
  const nextTierContextWindowSources = isCapabilitySource(runtimeProfile.contextWindowTokensSource)
    ? resolveTierContextWindowSources({
        current: runtimeCfg.llm.tierContextWindowSources as TierContextWindowSourceMapping | undefined,
        nextTier: effectiveTier,
        nextSource: runtimeProfile.contextWindowTokensSource,
      })
    : clearTierContextWindowSource({
        current: runtimeCfg.llm.tierContextWindowSources as TierContextWindowSourceMapping | undefined,
        nextTier: effectiveTier,
      })
  const nextTierContextWindowConfidence = isCapabilitySource(runtimeProfile.contextWindowTokensSource)
    ? resolveTierContextWindowConfidence({
        current: runtimeCfg.llm.tierContextWindowConfidence as TierContextWindowConfidenceMapping | undefined,
        nextTier: effectiveTier,
        nextConfidence: confidenceForSource(runtimeProfile.contextWindowTokensSource),
      })
    : clearTierContextWindowConfidence({
        current: runtimeCfg.llm.tierContextWindowConfidence as TierContextWindowConfidenceMapping | undefined,
        nextTier: effectiveTier,
      })
  if (
    runtimeCfg.llm.contextWindowTokens === detectedWindowTokens &&
    runtimeCfg.llm.tierContextWindowTokens?.[effectiveTier] === detectedWindowTokens &&
    (!nextTierContextWindowBindings ||
      (runtimeCfg.llm.tierContextWindowBindings?.[effectiveTier]?.model === nextBinding.model &&
        runtimeCfg.llm.tierContextWindowBindings?.[effectiveTier]?.provider === nextBinding.provider &&
        runtimeCfg.llm.tierContextWindowBindings?.[effectiveTier]?.baseUrl === nextBinding.baseUrl)) &&
    (!nextTierContextWindowSources ||
      runtimeCfg.llm.tierContextWindowSources?.[effectiveTier] === nextTierContextWindowSources[effectiveTier]) &&
    (!nextTierContextWindowConfidence ||
      runtimeCfg.llm.tierContextWindowConfidence?.[effectiveTier] === nextTierContextWindowConfidence[effectiveTier])
  ) {
    return
  }

  await updateConfigPatchFile({
    fileStore: store,
    filePath: paths.globalConfigPath,
    nextPatch: {
      llm: {
        contextWindowTokens: detectedWindowTokens,
        tierContextWindowTokens: nextTierContextWindowTokens,
        ...(nextTierContextWindowSources ? { tierContextWindowSources: nextTierContextWindowSources } : {}),
        ...(nextTierContextWindowConfidence ? { tierContextWindowConfidence: nextTierContextWindowConfidence } : {}),
        ...(nextTierContextWindowBindings ? { tierContextWindowBindings: nextTierContextWindowBindings } : {}),
      },
    },
    label: 'llm.contextWindowTokens/llm.tierContextWindowTokens',
  })
}

export async function loadWorkspaceRoots(args?: {
  cwd?: string
}): Promise<WorkspaceRootsResult> {
  const cwd = args?.cwd ?? process.cwd()
  const store = createNodeFileStore()
  return detectWorkspaceRoots({ fileStore: store, cwd })
}
