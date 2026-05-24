const RETRIABLE_NETWORK_ERROR_RE =
  /\b(fetch failed|network request failed|econnreset|econnrefused|ehostunreach|enotfound|eai_again|etimedout|socket hang up|connection reset|connection refused|connection terminated|other side closed|tls|undici)\b/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function describeError(value: unknown): string {
  if (value instanceof Error) {
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const message = typeof value.message === 'string' ? value.message.trim() : ''
    if (name === 'Error') return message || 'Error'
    if (name && message && message !== name) return `${name}: ${message}`
    return message || name || String(value)
  }

  if (typeof value === 'string') return value

  const record = asRecord(value)
  if (record) {
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    if (name === 'Error') return message || 'Error'
    if (name && message && message !== name) return `${name}: ${message}`
    if (message) return message
    if (name) return name
  }

  return String(value)
}

function getErrorCause(value: unknown): unknown {
  const record = asRecord(value)
  return record?.cause
}

function collectErrorChain(error: unknown, maxDepth = 6): string[] {
  const lines: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  let depth = 0

  while (current !== undefined && current !== null && depth < maxDepth && !seen.has(current)) {
    seen.add(current)
    const line = describeError(current).trim()
    if (line && !lines.includes(line)) lines.push(line)
    current = getErrorCause(current)
    depth++
  }

  return lines
}

export function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true

  return collectErrorChain(error).some((line) => {
    if (line === 'AbortError') return true
    if (/^AbortError:\s*/.test(line)) return true
    if (line === 'Stream aborted' || line === 'Request aborted') return true
    return /aborted/i.test(line)
  })
}

export function formatErrorWithCauses(error: unknown): string {
  const chain = collectErrorChain(error)
  if (chain.length === 0) return String(error)

  const [head, ...tail] = chain
  if (tail.length === 0) return head
  return `${head} (cause: ${tail.join(' <- ')})`
}

export function isRetriableNetworkError(error: unknown): boolean {
  if (isAbortLikeError(error)) return false
  const chain = collectErrorChain(error)
  return chain.some((line) => RETRIABLE_NETWORK_ERROR_RE.test(line))
}
