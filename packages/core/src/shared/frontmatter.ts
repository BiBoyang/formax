export type MarkdownFrontmatter = {
  attributes: Record<string, string>
  body: string
}

export function parseMarkdownFrontmatter(raw: string): MarkdownFrontmatter | null {
  const text = String(raw ?? '')
  if (!text.startsWith('---')) return null

  const end = text.indexOf('\n---', 3)
  if (end === -1) return null

  const header = text.slice(3, end).trim()
  const body = text.slice(end + '\n---'.length).replace(/^\s+/, '')
  const attributes: Record<string, string> = {}

  for (const line of header.split(/\r?\n/g)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue

    const key = trimmed.slice(0, idx).trim()
    if (!key) continue

    let value = trimmed.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    attributes[key] = value
  }

  return { attributes, body }
}

export function extractFirstMeaningfulLine(md: string): string {
  const lines = String(md ?? '').split(/\r?\n/g)
  const first = lines.find((l) => l.trim().length > 0)
  if (!first) return ''

  const cleaned = first
    .replace(/^#+\s*/, '')
    .replace(/^\*\s*/, '')
    .replace(/^-+\s*/, '')
    .trim()

  return cleaned.slice(0, 80)
}

