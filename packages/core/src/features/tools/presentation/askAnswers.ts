function toAskAnswers(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    out[String(key)] = String(rawValue ?? '')
  }
  return out
}

export function parseAskAnswers(raw: string): Record<string, string> | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const answers = (parsed as { answers?: unknown } | null)?.answers
    return toAskAnswers(answers)
  } catch {
    return null
  }
}

export function parseAskAnswerLines(lines: string[]): { answerCount: number; lines: string[] } | null {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const text = lines.join('\n').trim()
  if (!text.startsWith('{')) return null
  const answers = parseAskAnswers(text)
  if (!answers) return null
  const entries = Object.entries(answers)
  return {
    answerCount: entries.length,
    lines: entries.map(([key, value]) => `${key}: ${value}`),
  }
}
