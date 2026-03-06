import path from 'node:path'
import { resolveRuntimeConfig } from '../config/settings/resolve.js'
import type { FileStore } from '../config/settings/fileStore.js'
import { createNodeFileStore } from './nodeFileStore.js'
import { loadConfigFiles } from './configFiles.js'
import { getConfigPaths } from './configPaths.js'
import { resolveActiveModel } from './modelTier.js'
import type { ModelTier, ProviderId } from '../config/settings/schema.js'

export type RuntimeConfig = {
  llm: {
    provider: ProviderId
    baseUrl: string
    apiKey: string
    model: string
    configuredModel?: string
    tierModels?: Partial<Record<ModelTier, string>>
    defaultTier?: ModelTier
    timeoutMs: number
    contextWindowTokens?: number
    thinkingMode: boolean
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
  const { defaultTier, model } = resolveActiveModel({
    defaultTierRaw: resolved.config.llm.defaultTier,
    configuredModel: resolved.config.llm.model,
    configuredTierModels: resolved.config.llm.tierModels,
    env: env as Record<string, string | undefined>,
  })
  const configuredModel = String(resolved.config.llm.model || '').trim()
  const tierModels = resolved.config.llm.tierModels
  const timeoutMs = resolved.config.llm.timeoutMs || 600000
  const contextWindowTokens = resolved.config.llm.contextWindowTokens
  const thinkingMode = resolved.config.llm.thinkingMode
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
      configuredModel,
      ...(tierModels ? { tierModels } : {}),
      defaultTier,
      timeoutMs,
      ...(contextWindowTokens ? { contextWindowTokens } : {}),
      thinkingMode,
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
