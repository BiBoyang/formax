import type { ReactiveCompactErrorKind } from '../shared/reactiveCompactTypes'
export type { ReactiveCompactErrorKind } from '../shared/reactiveCompactTypes'

const REACTIVE_COMPACT_PATTERNS: ReadonlyArray<{
  kind: ReactiveCompactErrorKind
  pattern: RegExp
}> = [
  { kind: 'http_413', pattern: /\bHTTP 413\b/i },
  { kind: 'http_413', pattern: /\bAPI Error:\s*413\b/i },
  { kind: 'request_too_large', pattern: /\brequest (entity )?too large\b/i },
  { kind: 'input_too_long', pattern: /\binput too long\b/i },
  { kind: 'prompt_too_long', pattern: /\bprompt (is )?too long\b/i },
  { kind: 'maximum_context_length', pattern: /\bmaximum context length\b/i },
  { kind: 'context_length_exceeded', pattern: /\bcontext length exceeded\b/i },
  { kind: 'context_limit', pattern: /\bcontext limit\b/i },
  { kind: 'too_many_tokens', pattern: /\btoo many tokens\b/i },
  { kind: 'reduce_messages_length', pattern: /\breduce the length of the messages\b/i },
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

export function classifyReactiveCompactError(error: unknown): {
  kind: ReactiveCompactErrorKind
  detail: string
} | null {
  const message = getErrorMessage(error).trim()
  if (!message) return null
  if (NON_REACTIVE_PATTERNS.some((pattern) => pattern.test(message))) return null
  const match = REACTIVE_COMPACT_PATTERNS.find(({ pattern }) => pattern.test(message))
  if (!match) return null
  return {
    kind: match.kind,
    detail: message,
  }
}

export function isReactiveCompactEligibleError(error: unknown): boolean {
  return classifyReactiveCompactError(error) != null
}
