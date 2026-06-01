import path from 'node:path'
import { resolveRuntimeConfig } from '../config/settings/resolve.js'
import type { FileStore } from '../config/settings/fileStore.js'
import { createNodeFileStore } from './nodeFileStore.js'
import { loadConfigFiles } from './configFiles.js'
import { getConfigPaths } from './configPaths.js'
import { resolveActiveModel } from './modelTier.js'
import type {
  CapabilityConfidence,
  CapabilitySource,
  ConfigBudgetSource,
  ModelIdentity,
  ModelSource,
  ModelTier,
  ProviderId,
  ThinkingEffort,
} from '../config/settings/schema.js'

export type RuntimeConfig = {
  llm: {
    provider: ProviderId
    baseUrl: string
    apiKey: string
    model: string
    modelSource?: ModelSource
    configuredModel?: string
    tierModels?: Partial<Record<ModelTier, string>>
    tierContextWindowTokens?: Partial<Record<ModelTier, number>>
    tierContextWindowSources?: Partial<Record<ModelTier, CapabilitySource>>
    tierContextWindowConfidence?: Partial<Record<ModelTier, CapabilityConfidence>>
    tierContextWindowBindings?: Partial<Record<ModelTier, ModelIdentity>>
    defaultTier?: ModelTier
    authRef?: string
    timeoutMs: number
    contextWindowTokens?: number
    contextWindowTokensSource?: ConfigBudgetSource | CapabilitySource
    contextWindowTokensBoundModel?: string
    contextWindowTokensBinding?: ModelIdentity
    thinkingMode: boolean
    thinkingEffort: ThinkingEffort
  }
  paths: {
    logsDir: string
    subagentsDir: string
    planDir: string
  }
  context: {
    effectiveContextWindowPercent: number
    autoCompactTokenLimitPercent: number
    baselineTokens: number
    compactKeepLastTurns: number
    enableAutoCompact: boolean
    autoCompactMinTurnsBetweenRuns: number
  }
  ui: {
    assistantTextMode: 'stream' | 'buffered'
    showContextMeter: boolean
    showAutoCompactNotice: boolean
    outputStyle: 'default' | 'explanatory' | 'learning'
    verboseOutput: boolean
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return ''
  return raw.replace(/\/+$/, '')
}

function parsePositiveEnvInt(value: string | undefined): number | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

function sameBinding(args: {
  binding: ModelIdentity | undefined
  provider: ProviderId
  baseUrl: string
  model: string
}): boolean {
  const binding = args.binding
  if (!binding) return false
  return (
    binding.provider === args.provider &&
    normalizeBaseUrl(binding.baseUrl) === normalizeBaseUrl(args.baseUrl) &&
    String(binding.model || '').trim() === String(args.model || '').trim()
  )
}

export async function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  opts: { fileStore?: FileStore; platform?: string; homedir?: string } = {},
): Promise<RuntimeConfig> {
  const store = opts.fileStore ?? createNodeFileStore()
  const disk = await loadConfigFiles({
    fileStore: store,
    cwd,
    env,
    platform: opts.platform,
    homedir: opts.homedir,
  })
  const resolved = resolveRuntimeConfig({
    env: env as Record<string, string | undefined>,
    globalConfig: disk.globalConfig,
    projectConfig: disk.projectConfig,
    authStore: disk.authStore,
  })

  const logsDirRaw = resolved.config.paths.logsDir || env.FORMAX_LOGS_DIR || ''
  const logsDir = logsDirRaw
    ? path.resolve(cwd, logsDirRaw)
    : path.resolve(cwd, 'proxy/logs')

  const configPaths = getConfigPaths({
    cwd,
    env,
    platform: opts.platform,
    homedir: opts.homedir,
  })

  const globalConfigDir = path.resolve(cwd, configPaths.globalConfigDir)
  const defaultSubagentsDir = path.join(configPaths.projectConfigDir, 'agents')
  const defaultPlanDir = path.join(globalConfigDir, 'plans')

  const subagentsDirRaw = resolved.config.paths.subagentsDir || env.FORMAX_SUBAGENTS_DIR || ''
  const subagentsDir = subagentsDirRaw
    ? path.resolve(cwd, subagentsDirRaw)
    : defaultSubagentsDir

  const planDirRaw = resolved.config.paths.planDir || env.FORMAX_PLAN_DIR || ''
  const planDir = planDirRaw ? path.resolve(cwd, planDirRaw) : defaultPlanDir

  const apiKey = resolved.auth?.apiKey || ''
  const provider = resolved.config.llm.provider
  const baseUrl = normalizeBaseUrl(resolved.config.llm.baseUrl || env.FORMAX_BASE_URL || '')
  const { defaultTier, model, modelSource } = resolveActiveModel({
    defaultTierRaw: resolved.config.llm.defaultTier,
    configuredModel: resolved.config.llm.model,
    configuredTierModels: resolved.config.llm.tierModels,
    env: env as Record<string, string | undefined>,
  })
  const configuredModel = String(resolved.config.llm.model || '').trim()
  const tierModels = resolved.config.llm.tierModels
  const tierContextWindowTokens = resolved.config.llm.tierContextWindowTokens
  const tierContextWindowSources = resolved.config.llm.tierContextWindowSources
  const tierContextWindowConfidence = resolved.config.llm.tierContextWindowConfidence
  const tierContextWindowBindings = resolved.config.llm.tierContextWindowBindings
  const authRef = String(resolved.config.llm.authRef || 'default').trim() || 'default'
  const timeoutMs = resolved.config.llm.timeoutMs || 600000
  const envContextWindowTokens = parsePositiveEnvInt(env.FORMAX_CONTEXT_WINDOW_TOKENS)
  const tierContextWindow = defaultTier ? tierContextWindowTokens?.[defaultTier] : undefined
  const tierContextWindowBinding = defaultTier ? tierContextWindowBindings?.[defaultTier] : undefined
  const tierContextWindowBindingMatches = defaultTier
    ? sameBinding({
        binding: tierContextWindowBinding,
        provider,
        baseUrl,
        model,
      })
    : false
  const contextWindowTokensSource: ConfigBudgetSource | CapabilitySource =
    envContextWindowTokens != null
      ? 'env_override'
      : tierContextWindow != null
        ? tierContextWindowBinding
          ? (tierContextWindowBindingMatches
              ? (defaultTier ? tierContextWindowSources?.[defaultTier] ?? 'tier_config' : 'tier_config')
              : 'binding_mismatch')
          : 'migrated_legacy'
        : resolved.config.llm.contextWindowTokens != null
          ? 'legacy_config'
          : 'none'
  const contextWindowTokens =
    envContextWindowTokens ??
    (contextWindowTokensSource === 'binding_mismatch' ? undefined : tierContextWindow) ??
    resolved.config.llm.contextWindowTokens
  const thinkingMode = resolved.config.llm.thinkingMode
  const thinkingEffort = resolved.config.llm.thinkingEffort
  const assistantTextMode = resolved.config.ui.assistantTextMode
  const showContextMeter = resolved.config.ui.showContextMeter
  const showAutoCompactNotice = resolved.config.ui.showAutoCompactNotice
  const outputStyle = resolved.config.ui.outputStyle
  const verboseOutput = resolved.config.ui.verboseOutput
  const context = resolved.config.context

  return {
    llm: {
      provider,
      baseUrl,
      apiKey,
      model,
      modelSource,
      configuredModel,
      ...(tierModels ? { tierModels } : {}),
      ...(tierContextWindowTokens ? { tierContextWindowTokens } : {}),
      ...(tierContextWindowSources ? { tierContextWindowSources } : {}),
      ...(tierContextWindowConfidence ? { tierContextWindowConfidence } : {}),
      ...(tierContextWindowBindings ? { tierContextWindowBindings } : {}),
      defaultTier,
      authRef,
      timeoutMs,
      ...(contextWindowTokens ? { contextWindowTokens } : {}),
      contextWindowTokensSource,
      ...(contextWindowTokensSource !== 'binding_mismatch' &&
      contextWindowTokensSource !== 'migrated_legacy' &&
      contextWindowTokensSource !== 'legacy_config' &&
      contextWindowTokensSource !== 'env_override' &&
      contextWindowTokensSource !== 'none' &&
      tierContextWindowBindingMatches &&
      tierContextWindowBinding
        ? {
            contextWindowTokensBoundModel: tierContextWindowBinding.model,
            contextWindowTokensBinding: tierContextWindowBinding,
          }
        : {}),
      thinkingMode,
      thinkingEffort,
    },
    paths: {
      logsDir,
      subagentsDir,
      planDir,
    },
    context: {
      effectiveContextWindowPercent: context.effectiveContextWindowPercent,
      autoCompactTokenLimitPercent: context.autoCompactTokenLimitPercent,
      baselineTokens: context.baselineTokens,
      compactKeepLastTurns: context.compactKeepLastTurns,
      enableAutoCompact: context.enableAutoCompact,
      autoCompactMinTurnsBetweenRuns: context.autoCompactMinTurnsBetweenRuns,
    },
    ui: {
      assistantTextMode,
      showContextMeter,
      showAutoCompactNotice,
      outputStyle,
      verboseOutput,
    },
  }
}
