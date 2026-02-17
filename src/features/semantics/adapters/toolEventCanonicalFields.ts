type ToolResultLike = {
  content?: unknown
  is_error?: unknown
}

type ToolEventLike = {
  transcriptLines?: unknown
  middleLines?: unknown
  toolUses?: unknown
  result?: unknown
}

export function readCanonicalToolUpdateLine(event: ToolEventLike): string | undefined {
  const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
  if (transcriptLines.length > 0) {
    const line = String(transcriptLines[transcriptLines.length - 1] ?? '').trim()
    if (line) return line
  }

  const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
  if (middleLines.length > 0) {
    const line = String(middleLines[middleLines.length - 1] ?? '').trim()
    if (line) return line
  }

  if (typeof event.toolUses === 'number' && Number.isFinite(event.toolUses)) {
    return `tool uses ${event.toolUses}`
  }
  return undefined
}

export function readCanonicalToolEndSummary(
  event: ToolEventLike,
  options: { includeCompletedFallback?: boolean } = {},
): string | undefined {
  const result = event.result
  if (!result || typeof result !== 'object') {
    return options.includeCompletedFallback ? 'completed' : undefined
  }

  const resultLike = result as ToolResultLike
  const content = String(resultLike.content ?? '').trim()
  if (content) return content

  if (Boolean(resultLike.is_error)) return 'error'
  return options.includeCompletedFallback ? 'completed' : undefined
}
