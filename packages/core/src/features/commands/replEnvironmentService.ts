import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots, type WorkspaceRootsResult } from '../../adapters/fs/workspaceRoots'
import { getKnownContextWindowTokens } from '../../chat/context/modelWindow'
import { loadRuntimeConfig } from '../../config/config'
import { updateConfigPatchFile } from '../../config/settings/persist'
import type { ModelTier } from '../../config/modelTier'

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

const DEFAULT_TIER_CONTEXT_WINDOW_TOKENS: Record<ModelTier, number> = {
  haiku: 32768,
  sonnet: 32768,
  opus: 32768,
}

function resolveTierContextWindowTokens(args: {
  current?: Partial<Record<ModelTier, number>>
  fallback?: number
  nextTier: ModelTier
  nextTokens: number
}): Record<ModelTier, number> {
  const fallback = toPositiveInt(args.fallback) ?? 32768
  const current = args.current ?? {}
  return {
    haiku: toPositiveInt(current.haiku) ?? fallback,
    sonnet: toPositiveInt(current.sonnet) ?? fallback,
    opus: toPositiveInt(current.opus) ?? fallback,
    [args.nextTier]: args.nextTokens,
  }
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
  const activeModel = String(runtimeCfg.llm.model || '').trim()
  if (!activeModel) return
  const effectiveTier = runtimeCfg.llm.defaultTier ?? args.nextTier
  const envContextWindowOverride = toPositiveInt(env.FORMAX_CONTEXT_WINDOW_TOKENS)
  const persistedContextWindowFallback =
    envContextWindowOverride === null ? toPositiveInt(runtimeCfg.llm.contextWindowTokens) : null

  const detectedWindowTokens =
    toPositiveInt(runtimeCfg.llm.tierContextWindowTokens?.[effectiveTier]) ??
    toPositiveInt(
      getKnownContextWindowTokens({
        provider: runtimeCfg.llm.provider,
        model: activeModel,
      }),
    ) ??
    persistedContextWindowFallback
  if (!detectedWindowTokens) return
  const nextTierContextWindowTokens = resolveTierContextWindowTokens({
    current: runtimeCfg.llm.tierContextWindowTokens,
    fallback: persistedContextWindowFallback ?? DEFAULT_TIER_CONTEXT_WINDOW_TOKENS[effectiveTier],
    nextTier: effectiveTier,
    nextTokens: detectedWindowTokens,
  })
  if (
    runtimeCfg.llm.contextWindowTokens === detectedWindowTokens &&
    runtimeCfg.llm.tierContextWindowTokens?.[effectiveTier] === detectedWindowTokens
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
