export function toCanonicalTimestamp(now?: () => string): string {
  const value = now?.()
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

export function inferCanonicalFailureStatus(errorText: string): 'failed' | 'interrupted' {
  const normalized = errorText.toLowerCase()
  if (normalized.includes('interrupt') || normalized.includes('abort') || normalized.includes('cancel')) {
    return 'interrupted'
  }
  return 'failed'
}
