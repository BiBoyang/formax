export const FORMAX_ANTHROPIC_CACHE_EDITING_BETA_HEADER = 'FORMAX_ANTHROPIC_CACHE_EDITING_BETA_HEADER'

export function resolveAnthropicCacheEditingBetaHeader(args: {
  provider: string
  baseUrl: string
  env?: NodeJS.ProcessEnv
}): string | null {
  if (args.provider !== 'anthropic') return null
  if (!isFirstPartyAnthropicBaseUrl(args.baseUrl)) return null
  const header = String((args.env ?? process.env)[FORMAX_ANTHROPIC_CACHE_EDITING_BETA_HEADER] || '').trim()
  return header || null
}

export function isAnthropicCacheEditingEnabled(args: {
  provider: string
  baseUrl: string
  env?: NodeJS.ProcessEnv
}): boolean {
  return resolveAnthropicCacheEditingBetaHeader(args) != null
}

function isFirstPartyAnthropicBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com'
  } catch {
    return false
  }
}
