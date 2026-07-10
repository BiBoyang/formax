export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'unknown'

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n)
}

function modelIdCandidates(model: string): string[] {
  const full = String(model || '').trim().toLowerCase()
  if (!full) return []
  const pathSegments = full.split('/').map((segment) => segment.trim()).filter(Boolean)
  const leaf = pathSegments.at(-1) ?? full
  return leaf === full ? [full] : [full, leaf]
}

function isKnownClaude200kModel(model: string): boolean {
  if (model.startsWith('claude-3')) return true
  return /^claude-(?:haiku|sonnet|opus)-4(?:-\d+(?:-\d{8})?|-latest)?$/.test(model)
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
  const candidates = modelIdCandidates(model)
  if (candidates.length === 0) return 32768
  if (candidates.some(isKnownClaude200kModel)) return 200000
  if (candidates.some((m) => m.startsWith('gpt-4o') || m.startsWith('gpt-4.1') || m.startsWith('gpt-4-turbo'))) return 128000
  if (candidates.some((m) => m === 'gpt-4' || m.startsWith('gpt-4-'))) return 8192
  if (candidates.some((m) => m.startsWith('gpt-3.5'))) return 16385
  if (candidates.some((m) => m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4'))) return 128000
  return 32768
}

export function getKnownContextWindowTokens(args: {
  provider: LlmProvider
  model: string
}): number | null {
  const candidates = modelIdCandidates(args.model)
  if (candidates.length === 0) return null

  if (args.provider === 'anthropic') {
    if (candidates.some(isKnownClaude200kModel)) return 200_000
    return null
  }

  if (args.provider === 'openai') {
    if (candidates.some((model) => model.startsWith('gpt-4o'))) return 128_000
    if (candidates.some((model) => model.startsWith('gpt-4-turbo'))) return 128_000
    if (candidates.some((model) => model.startsWith('gpt-3.5-turbo'))) return 16_385
    return null
  }

  return null
}
