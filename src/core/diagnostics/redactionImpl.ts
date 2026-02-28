export function redactTextSecrets(text: string): string {
  let out = String(text || '')

  // Common key prefix patterns (OpenAI/Anthropic-style)
  out = out.replace(/\bsk-[a-z0-9_-]{6,}\b/gi, 'sk-<redacted>')

  // Common HTTP auth headers
  out = out.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1<redacted>')
  out = out.replace(/(x-api-key:\s*)[^\s]+/gi, '$1<redacted>')

  return out
}

export function redactJsonSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactTextSecrets(value)
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redactJsonSecrets(v))
  if (typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) out[k] = '<redacted>'
    else out[k] = redactJsonSecrets(v)
  }
  return out
}

function isSecretKey(key: string): boolean {
  const k = String(key || '').toLowerCase()
  return (
    k.includes('apikey') ||
    k.includes('api_key') ||
    k.includes('token') ||
    k.includes('authorization') ||
    k.includes('password') ||
    k.includes('secret')
  )
}

