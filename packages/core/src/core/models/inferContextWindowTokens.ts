export function inferContextWindowTokens(model: string): number {
  const m = String(model || '').trim().toLowerCase()
  if (!m) return 32768
  if (m.startsWith('claude-')) return 200000
  if (m.startsWith('gpt-4o') || m.startsWith('gpt-4.1') || m.startsWith('gpt-4-turbo')) return 128000
  if (m === 'gpt-4' || m.startsWith('gpt-4-')) return 8192
  if (m.startsWith('gpt-3.5')) return 16385
  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 128000
  return 32768
}
