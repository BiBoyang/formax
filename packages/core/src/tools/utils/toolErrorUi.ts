const OMIT_DETAIL_PATTERNS: RegExp[] = [
  /^ErrorCode:/i,
  /^Workspace roots:/i,
  /^Hint:/i,
  /^See docs:/i,
  /^Try\b/i,
  /^Re-run\b/i,
  /\bsub-?agent\b/i,
]

export function pickCompactErrorDetailLine(args: {
  middleLines?: string[]
  expandInfo?: string
}): string | null {
  const candidates: string[] = []

  if (Array.isArray(args.middleLines)) candidates.push(...args.middleLines)
  if (typeof args.expandInfo === 'string' && args.expandInfo.trim()) candidates.push(args.expandInfo)

  for (const line of candidates) {
    const trimmed = String(line ?? '').trim()
    if (!trimmed) continue
    if (OMIT_DETAIL_PATTERNS.some((re) => re.test(trimmed))) continue
    return trimmed
  }

  return null
}
