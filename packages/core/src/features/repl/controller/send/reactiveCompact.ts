const REACTIVE_COMPACT_PATTERNS = [
  /\bHTTP 413\b/i,
  /\bAPI Error:\s*413\b/i,
  /\brequest (entity )?too large\b/i,
  /\binput too long\b/i,
  /\bprompt (is )?too long\b/i,
  /\bmaximum context length\b/i,
  /\bcontext length exceeded\b/i,
  /\bcontext limit\b/i,
  /\btoo many tokens\b/i,
  /\breduce the length of the messages\b/i,
] as const

const NON_REACTIVE_PATTERNS = [
  /\bHTTP 401\b/i,
  /\bHTTP 403\b/i,
  /\bHTTP 429\b/i,
  /\bAPI Error:\s*401\b/i,
  /\bAPI Error:\s*403\b/i,
  /\bAPI Error:\s*429\b/i,
  /\brate limit\b/i,
  /\bauth(entication)?\b/i,
] as const

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

export function isReactiveCompactEligibleError(error: unknown): boolean {
  const message = getErrorMessage(error).trim()
  if (!message) return false
  if (NON_REACTIVE_PATTERNS.some((pattern) => pattern.test(message))) return false
  return REACTIVE_COMPACT_PATTERNS.some((pattern) => pattern.test(message))
}
