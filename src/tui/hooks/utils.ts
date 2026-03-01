import type { HookRuleEntry, HookSource } from '../../hooks/types.js'

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

export function formatMatcherLabel(matcher: string): string {
  const raw = String(matcher ?? '').trim()
  return raw
}

export function formatSourceLabel(source: HookSource): string {
  switch (source) {
    case 'projectLocal':
      return 'Local Settings'
    case 'project':
      return 'Project Settings'
    case 'user':
      return 'User Settings'
    default:
      return 'Unknown Settings'
  }
}

export function groupHookEntriesByMatcher(entries: HookRuleEntry[]): Array<{ matcher: string; entries: HookRuleEntry[] }> {
  const map = new Map<string, HookRuleEntry[]>()
  const order: string[] = []

  for (const e of entries) {
    const matcher = String(e.matcher ?? '').trim()
    const list = map.get(matcher)
    if (!list) {
      map.set(matcher, [e])
      order.push(matcher)
      continue
    }
    list.push(e)
  }

  return order.map((matcher) => ({ matcher, entries: map.get(matcher) as HookRuleEntry[] }))
}
