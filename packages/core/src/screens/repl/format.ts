import type { TokenUsage } from '../../streaming/types'

export function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}m`
}

export function sumTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  )
}

export function truncate(s: string, max: number): string {
  const str = String(s || '')
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
