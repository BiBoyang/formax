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

async function scanRequestCollapseEvents(filePath: string): Promise<PersistedRequestCollapseEvent[]> {
  const events: PersistedRequestCollapseEvent[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'request_collapse_applied') continue
    const event = parseRequestCollapseEvent(parsed.ts, parsed.data)
    if (!event) continue
    events.push(event)
  }

  return events
}

export async function readRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent[]> {
  return scanRequestCollapseEvents(args.filePath)
}

export async function readLatestRequestCollapseEventFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent | null> {
  const events = await scanRequestCollapseEvents(args.filePath)
  return events.length > 0 ? events[events.length - 1]! : null
}

export async function inspectRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseInspection> {
  const events = await scanRequestCollapseEvents(args.filePath)
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
  let latest: PersistedRequestCollapseEvent | null = null
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return null
  }
  for (const line of raw.split('\n')) {
    const trimmed = String(line).trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'request_collapse_applied') continue
    const event = parseRequestCollapseEvent(parsed.ts, parsed.data)
    if (!event) continue
    latest = event
  }
  return latest
}
