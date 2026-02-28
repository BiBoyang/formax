export function truncateByCharBudget(
  lines: string[],
  limit: number,
): { kept: string[]; truncated: boolean } {
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  const kept: string[] = []

  let used = 0
  for (const line of lines) {
    const text = String(line)
    const cost = text.length + 1 // include newline separator
    if (used + cost > budget) return { kept, truncated: true }
    kept.push(text)
    used += cost
  }

  return { kept, truncated: false }
}
