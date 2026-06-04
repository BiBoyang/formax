export function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>()

  const normalize = (next: unknown): unknown => {
    if (next === null || typeof next !== 'object') return next
    if (seen.has(next)) return '[Circular]'
    seen.add(next)
    if (Array.isArray(next)) return next.map(normalize)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(next as Record<string, unknown>).sort()) {
      out[key] = normalize((next as Record<string, unknown>)[key])
    }
    return out
  }

  return JSON.stringify(normalize(value))
}
