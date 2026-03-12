const NAMED_AGENT_COLORS: Record<string, string> = {
  red: '#ff3b30',
  blue: '#0a84ff',
  green: '#34c759',
  yellow: '#ffd60a',
  purple: '#bf5af2',
  orange: '#ff9f0a',
  pink: '#ff2d55',
  cyan: '#64d2ff',
}

export function formatSubagentDisplayName(subagentType: unknown, fallback = 'Task'): string {
  const raw = typeof subagentType === 'string' ? subagentType.trim() : ''
  if (!raw) return fallback

  const hasSeparator = /[_\-\s]+/.test(raw)
  if (!hasSeparator) {
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }

  const words = raw
    .split(/[_\-\s]+/)
    .map((w) => w.trim())
    .filter(Boolean)

  if (words.length === 0) return fallback

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

export function normalizeSubagentLookupKey(subagentType: unknown): string {
  const raw = typeof subagentType === 'string' ? subagentType.trim() : ''
  return raw.toLowerCase()
}

export function resolveSubagentColor(rawColor: unknown): string | null {
  const raw = typeof rawColor === 'string' ? rawColor.trim() : ''
  if (!raw) return null
  const lower = raw.toLowerCase()

  if (/^#[0-9a-f]{3}$/i.test(lower) || /^#[0-9a-f]{6}$/i.test(lower)) {
    return lower
  }

  return NAMED_AGENT_COLORS[lower] ?? null
}
