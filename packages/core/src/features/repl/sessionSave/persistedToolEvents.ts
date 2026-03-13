export type PersistedToolMessage = {
  id: string
  occurredAtMs: number
  sequence: number
  toolUseId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  input?: Record<string, unknown>
  patchStartLineNumber?: number
  paramsText?: string
  detailLines: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseToolStatus(value: unknown): 'running' | 'completed' | 'error' | null {
  if (value === 'error') return 'error'
  if (value === 'running') return 'running'
  if (value === 'completed') return 'completed'
  return null
}

function parseLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const lines: string[] = []
  for (const line of value) {
    if (typeof line !== 'string') continue
    const trimmed = line.trim()
    if (!trimmed) continue
    lines.push(trimmed)
  }
  return lines
}

function parseInputObject(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value) || Array.isArray(value)) return undefined
  return value
}

function parsePatchStartLineNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value <= 0) return undefined
  return Math.floor(value)
}

function appendUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim()
  if (lines[lines.length - 1] === normalized) return
  lines.push(normalized)
}

export type PersistedToolEventAggregator = {
  ingest: (args: { ts: unknown; data: unknown }) => void
  finalize: () => PersistedToolMessage[]
}

export function createPersistedToolEventAggregator(): PersistedToolEventAggregator {
  const byKey = new Map<string, PersistedToolMessage>()
  const activeAnonymousKeyByBucket = new Map<string, string>()
  let sequence = 0

  const ingest = (args: { ts: unknown; data: unknown }) => {
    const data = isObject(args.data) ? args.data : null
    if (!data) return

    const toolUseId = coerceNonEmptyString(data.toolUseId) ?? undefined
    const turnId = coerceNonEmptyString(data.turnId) ?? 'turn'
    const parsedToolName = coerceNonEmptyString(data.toolName)
    const toolName = parsedToolName ?? 'Tool'
    const phase = coerceNonEmptyString(data.phase)
    const bucketKey = `${turnId}:${toolName}`
    let key: string
    if (toolUseId) {
      key = toolUseId
    } else {
      if (phase === 'start' || !activeAnonymousKeyByBucket.has(bucketKey)) {
        activeAnonymousKeyByBucket.set(bucketKey, `anon:${bucketKey}:${sequence}`)
      }
      key = activeAnonymousKeyByBucket.get(bucketKey)!
    }

    const ts = parseTimestampMs(args.ts)
    const summary = coerceNonEmptyString(data.summary)
    const input = parseInputObject(data.input)
    const patchStartLineNumber = parsePatchStartLineNumber(data.patchStartLineNumber)
    const paramsText = coerceNonEmptyString(data.paramsText) ?? undefined
    const status = parseToolStatus(data.status)
    const lineValue = coerceNonEmptyString(data.line)
    const linesValue = parseLines(data.lines)

    let current = byKey.get(key)
    if (!current) {
      current = {
        id: `tool-${key}`,
        occurredAtMs: ts,
        sequence,
        ...(toolUseId ? { toolUseId } : {}),
        toolName,
        status: status ?? 'running',
        summary: summary ?? `${toolName} running`,
        ...(input ? { input } : {}),
        ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
        ...(paramsText ? { paramsText } : {}),
        detailLines: [],
      }
      byKey.set(key, current)
    }

    if (parsedToolName) current.toolName = parsedToolName
    if (status) current.status = status
    if (summary) current.summary = summary
    if (input) current.input = input
    if (patchStartLineNumber !== undefined) current.patchStartLineNumber = patchStartLineNumber
    if (paramsText) current.paramsText = paramsText
    if (lineValue) appendUniqueLine(current.detailLines, lineValue)
    for (const detailLine of linesValue) appendUniqueLine(current.detailLines, detailLine)
    if (current.occurredAtMs === 0 && ts > 0) current.occurredAtMs = ts

    const terminal = phase === 'end' || status === 'completed' || status === 'error'
    if (!toolUseId && terminal) {
      activeAnonymousKeyByBucket.delete(bucketKey)
    }
    sequence += 1
  }

  const finalize = (): PersistedToolMessage[] => {
    const out = Array.from(byKey.values())
    out.sort((a, b) => {
      if (a.occurredAtMs !== b.occurredAtMs) return a.occurredAtMs - b.occurredAtMs
      return a.sequence - b.sequence
    })
    return out
  }

  return { ingest, finalize }
}
