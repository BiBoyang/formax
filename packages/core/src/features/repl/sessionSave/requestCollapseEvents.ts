import fs from 'node:fs'
import readline from 'node:readline'

export type PersistedRequestCollapseEvent = {
  phase: 'initial' | 'reactive_retry'
  occurredAtMs: number
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  keepLastTurns?: number
  preservedTailMessageCount?: number
  retainedCompactSummary?: boolean
  recapFingerprint?: string
}

export type PersistedRequestCollapseInspection = {
  totalCount: number
  initialCount: number
  reactiveRetryCount: number
  totalEstimatedTokensSaved: number
  latest: PersistedRequestCollapseEvent | null
}

type IndexedRequestCollapseEvent = {
  event: PersistedRequestCollapseEvent
  lineIndex: number
}

type RequestCollapseScan = {
  events: PersistedRequestCollapseEvent[]
  indexedEvents: IndexedRequestCollapseEvent[]
  latestCompactBoundaryIntroducedAtLine: number | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function parseOccurredAtMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseRequestCollapseEvent(ts: unknown, data: unknown): PersistedRequestCollapseEvent | null {
  if (!isObject(data)) return null
  const phase = coerceNonEmptyString(data.phase)
  if (phase !== 'initial' && phase !== 'reactive_retry') return null
  const collapsedHeadMessageCount = parsePositiveInt(data.collapsedHeadMessageCount)
  const estimatedTokensSaved = parsePositiveInt(data.estimatedTokensSaved)
  if (collapsedHeadMessageCount == null || estimatedTokensSaved == null) return null
  const occurredAtMs = parseOccurredAtMs(ts)
  return {
    phase,
    occurredAtMs,
    collapsedHeadMessageCount,
    estimatedTokensSaved,
    ...(parsePositiveInt(data.keepLastTurns) != null ? { keepLastTurns: parsePositiveInt(data.keepLastTurns)! } : {}),
    ...(parsePositiveInt(data.preservedTailMessageCount) != null
      ? { preservedTailMessageCount: parsePositiveInt(data.preservedTailMessageCount)! }
      : {}),
    ...(parseBool(data.retainedCompactSummary) !== undefined
      ? { retainedCompactSummary: parseBool(data.retainedCompactSummary) }
      : {}),
    ...(coerceNonEmptyString(data.recapFingerprint)
      ? { recapFingerprint: coerceNonEmptyString(data.recapFingerprint)! }
      : {}),
  }
}

async function scanRequestCollapseState(filePath: string): Promise<RequestCollapseScan> {
  const events: PersistedRequestCollapseEvent[] = []
  const indexedEvents: IndexedRequestCollapseEvent[] = []
  let latestCompactBoundaryKey: string | null = null
  let latestCompactBoundaryIntroducedAtLine: number | null = null
  let lineIndex = 0
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    lineIndex += 1
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    const compactBoundaryKey = readLatestCompactBoundaryKeyFromRecord(parsed)
    if (compactBoundaryKey && compactBoundaryKey !== latestCompactBoundaryKey) {
      latestCompactBoundaryKey = compactBoundaryKey
      latestCompactBoundaryIntroducedAtLine = lineIndex
    }
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'request_collapse_applied') continue
    const event = parseRequestCollapseEvent(parsed.ts, parsed.data)
    if (!event) continue
    events.push(event)
    indexedEvents.push({ event, lineIndex })
  }

  return {
    events,
    indexedEvents,
    latestCompactBoundaryIntroducedAtLine,
  }
}

export async function readRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent[]> {
  return (await scanRequestCollapseState(args.filePath)).events
}

export async function readLatestRequestCollapseEventFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent | null> {
  return selectLatestRequestCollapseForCurrentCompactBoundary(await scanRequestCollapseState(args.filePath))
}

export async function inspectRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseInspection> {
  const events = (await scanRequestCollapseState(args.filePath)).events
  return {
    totalCount: events.length,
    initialCount: events.filter((event) => event.phase === 'initial').length,
    reactiveRetryCount: events.filter((event) => event.phase === 'reactive_retry').length,
    totalEstimatedTokensSaved: events.reduce((sum, event) => sum + event.estimatedTokensSaved, 0),
    latest: events.length > 0 ? events[events.length - 1]! : null,
  }
}

export function readLatestRequestCollapseEventFromSessionSync(args: {
  filePath: string
}): PersistedRequestCollapseEvent | null {
  const events: PersistedRequestCollapseEvent[] = []
  const indexedEvents: IndexedRequestCollapseEvent[] = []
  let latestCompactBoundaryKey: string | null = null
  let latestCompactBoundaryIntroducedAtLine: number | null = null
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return null
  }
  let lineIndex = 0
  for (const line of raw.split('\n')) {
    lineIndex += 1
    const trimmed = String(line).trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    const compactBoundaryKey = readLatestCompactBoundaryKeyFromRecord(parsed)
    if (compactBoundaryKey && compactBoundaryKey !== latestCompactBoundaryKey) {
      latestCompactBoundaryKey = compactBoundaryKey
      latestCompactBoundaryIntroducedAtLine = lineIndex
    }
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'request_collapse_applied') continue
    const event = parseRequestCollapseEvent(parsed.ts, parsed.data)
    if (!event) continue
    events.push(event)
    indexedEvents.push({ event, lineIndex })
  }
  return selectLatestRequestCollapseForCurrentCompactBoundary({
    events,
    indexedEvents,
    latestCompactBoundaryIntroducedAtLine,
  })
}

function selectLatestRequestCollapseForCurrentCompactBoundary(scan: RequestCollapseScan): PersistedRequestCollapseEvent | null {
  if (scan.latestCompactBoundaryIntroducedAtLine == null) {
    return scan.events.length > 0 ? scan.events[scan.events.length - 1]! : null
  }
  for (let index = scan.indexedEvents.length - 1; index >= 0; index -= 1) {
    const entry = scan.indexedEvents[index]!
    if (entry.lineIndex > scan.latestCompactBoundaryIntroducedAtLine) return entry.event
  }
  return null
}

function readLatestCompactBoundaryKeyFromRecord(record: Record<string, unknown>): string | null {
  if (record.type !== 'history_state') return null
  const messages = Array.isArray(record.messages) ? record.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isObject(message)) continue
    const meta = message.meta
    if (!isObject(meta)) continue
    const compactBoundary = meta.compactBoundary
    if (!isObject(compactBoundary)) continue
    return stableStringify(compactBoundary)
  }
  return null
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
