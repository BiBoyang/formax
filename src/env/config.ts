import path from 'node:path'

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
  }
  ui: {
    assistantTextMode: 'stream' | 'buffered'
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

  const apiKey = env.ANTHROPIC_API_KEY2 || ''
  const baseUrl = normalizeAnthropicBaseUrl(env.ANTHROPIC_BASE_URL2 || '')
  const model = env.ANTHROPIC_MODEL || ''
  const timeoutMsRaw = Number(env.ANTHROPIC_TIMEOUT_MS || 600000)
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 600000

  const assistantTextModeRaw = String(env.FORMAX_ASSISTANT_TEXT_MODE || '').trim().toLowerCase()
  const assistantTextMode = assistantTextModeRaw === 'stream' ? 'stream' : 'buffered'

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
    },
    ui: {
      assistantTextMode,
    },
  }
}
