export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'unknown'

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n)
}

export function extractContextWindowTokens(value: unknown): number | undefined {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, any>
  const tokenLimits = (row.token_limits && typeof row.token_limits === 'object' ? row.token_limits : {}) as Record<string, any>
  const tokenLimitsCamel = (row.tokenLimits && typeof row.tokenLimits === 'object' ? row.tokenLimits : {}) as Record<string, any>
  const limit = (row.limit && typeof row.limit === 'object' ? row.limit : {}) as Record<string, any>
  const limits = (row.limits && typeof row.limits === 'object' ? row.limits : {}) as Record<string, any>

  return (
    toPositiveInt(row.contextWindowTokens) ??
    toPositiveInt(row.context_window) ??
    toPositiveInt(row.context_length) ??
    toPositiveInt(row.max_input_tokens) ??
    toPositiveInt(row.max_input_token_length) ??
    toPositiveInt(row.inputTokenLimit) ??
    toPositiveInt(row.input_token_limit) ??
    toPositiveInt(tokenLimits.context_window) ??
    toPositiveInt(tokenLimits.context) ??
    toPositiveInt(tokenLimits.max_input_token_length) ??
    toPositiveInt(tokenLimits.maxInputTokenLength) ??
    toPositiveInt(tokenLimitsCamel.context_window) ??
    toPositiveInt(tokenLimitsCamel.contextWindow) ??
    toPositiveInt(tokenLimitsCamel.context) ??
    toPositiveInt(tokenLimitsCamel.max_input_token_length) ??
    toPositiveInt(tokenLimitsCamel.maxInputTokenLength) ??
    toPositiveInt(limit.context) ??
    toPositiveInt(limits.context)
  )
}

export function inferContextWindowTokens(model: string): number {
  const m = String(model || '').trim().toLowerCase()
  if (!m) return 32768
  if (m.startsWith('claude-')) return 200000
  if (m.startsWith('gpt-4o') || m.startsWith('gpt-4.1') || m.startsWith('gpt-4-turbo')) return 128000
  if (m === 'gpt-4' || m.startsWith('gpt-4-')) return 8192
  if (m.startsWith('gpt-3.5')) return 16385
  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 128000
  return 32768
}

export function getKnownContextWindowTokens(args: {
  provider: LlmProvider
  model: string
}): number | null {
  const model = (args.model || '').trim()
  if (!model) return null

  if (args.provider === 'anthropic') {
    if (model.startsWith('claude-3')) return 200_000
    return null
  }

  if (args.provider === 'openai') {
    if (model.startsWith('gpt-4o')) return 128_000
    if (model.startsWith('gpt-4-turbo')) return 128_000
    if (model.startsWith('gpt-3.5-turbo')) return 16_385
    return null
  }

  return null
}
