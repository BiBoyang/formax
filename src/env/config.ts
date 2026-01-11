import path from 'node:path'
import os from 'node:os'
import { resolveRuntimeConfig } from '../core/config/resolve.js'
import type { FileStore } from '../adapters/fs/fileStore.js'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { loadConfigFiles } from '../adapters/fs/configFiles.js'

export type RuntimeConfig = {
  llm: {
    provider: 'anthropic'
    baseUrl: string
    apiKey: string
    model: string
    timeoutMs: number
  }
  paths: {
    logsDir: string
    subagentsDir: string
    planDir: string
  }
  ui: {
    assistantTextMode: 'stream' | 'buffered'
    promptProfile: 'lite' | 'full'
  }
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
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

  const subagentsDirRaw = resolved.config.paths.subagentsDir || env.FORMAX_SUBAGENTS_DIR || ''
  const subagentsDir = subagentsDirRaw
    ? path.resolve(cwd, subagentsDirRaw)
    : path.resolve(cwd, '.agent/subagents')

  const defaultPlanDir = path.join(opts.homedir ?? os.homedir(), '.claude', 'plans')
  const planDirRaw = resolved.config.paths.planDir || env.FORMAX_PLAN_DIR || ''
  const planDir = planDirRaw ? path.resolve(cwd, planDirRaw) : defaultPlanDir

  const apiKey = resolved.auth?.apiKey || ''
  const baseUrl = normalizeAnthropicBaseUrl(resolved.config.llm.baseUrl || env.ANTHROPIC_BASE_URL2 || '')
  const model = resolved.config.llm.model || ''
  const timeoutMs = resolved.config.llm.timeoutMs || 600000
  const assistantTextMode = resolved.config.ui.assistantTextMode
  const promptProfile = resolved.config.ui.promptProfile

  return {
    llm: {
      provider: 'anthropic',
      baseUrl,
      apiKey,
      model,
      timeoutMs,
    },
    paths: {
      logsDir,
      subagentsDir,
      planDir,
    },
    ui: {
      assistantTextMode,
      promptProfile,
    },
  }
}
