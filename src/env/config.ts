import path from 'node:path'
import os from 'node:os'

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

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): RuntimeConfig {
  const logsDir = env.FORMAX_LOGS_DIR
    ? path.resolve(cwd, env.FORMAX_LOGS_DIR)
    : path.resolve(cwd, 'proxy/logs')

  const subagentsDir = env.FORMAX_SUBAGENTS_DIR
    ? path.resolve(cwd, env.FORMAX_SUBAGENTS_DIR)
    : path.resolve(cwd, '.agent/subagents')

  const defaultPlanDir = path.join(os.homedir(), '.claude', 'plans')
  const planDir = env.FORMAX_PLAN_DIR ? path.resolve(cwd, env.FORMAX_PLAN_DIR) : defaultPlanDir

  const apiKey = env.ANTHROPIC_API_KEY2 || ''
  const baseUrl = normalizeAnthropicBaseUrl(env.ANTHROPIC_BASE_URL2 || '')
  const model = env.ANTHROPIC_MODEL || ''
  const timeoutMsRaw = Number(env.ANTHROPIC_TIMEOUT_MS || 600000)
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 600000

  const assistantTextModeRaw = String(env.FORMAX_ASSISTANT_TEXT_MODE || '').trim().toLowerCase()
  const assistantTextMode = assistantTextModeRaw === 'stream' ? 'stream' : 'buffered'

  const promptProfileRaw = String(env.FORMAX_PROMPT_PROFILE || '').trim().toLowerCase()
  const promptProfile = promptProfileRaw === 'lite' ? 'lite' : 'full'

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
