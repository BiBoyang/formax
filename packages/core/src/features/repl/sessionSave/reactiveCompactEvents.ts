import fs from 'node:fs'
import readline from 'node:readline'

export type PersistedReactiveCompactErrorKind =
  | 'http_413'
  | 'request_too_large'
  | 'input_too_long'
  | 'prompt_too_long'
  | 'maximum_context_length'
  | 'context_length_exceeded'
  | 'context_limit'
  | 'too_many_tokens'
  | 'reduce_messages_length'

export type PersistedReactiveCompactEvent = {
  occurredAtMs: number
  triggerKind: PersistedReactiveCompactErrorKind
  triggerDetail?: string
  strategy: 'session_memory' | 'model_summary'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseOccurredAtMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseReactiveCompactTriggerKind(value: unknown): PersistedReactiveCompactErrorKind | null {
  return value === 'http_413' ||
    value === 'request_too_large' ||
    value === 'input_too_long' ||
    value === 'prompt_too_long' ||
    value === 'maximum_context_length' ||
    value === 'context_length_exceeded' ||
    value === 'context_limit' ||
    value === 'too_many_tokens' ||
    value === 'reduce_messages_length'
    ? value
    : null
}

function parseReactiveCompactEvent(ts: unknown, data: unknown): PersistedReactiveCompactEvent | null {
  if (!isObject(data)) return null
  const triggerKind = parseReactiveCompactTriggerKind(data.triggerKind)
  const strategy = data.strategy === 'session_memory' || data.strategy === 'model_summary' ? data.strategy : null
  const triggerDetail = coerceNonEmptyString(data.triggerDetail) ?? undefined
  if (!triggerKind || !strategy) return null
  return {
    occurredAtMs: parseOccurredAtMs(ts),
    triggerKind,
    strategy,
    ...(triggerDetail ? { triggerDetail } : {}),
  }
}

async function scanReactiveCompactEvents(filePath: string): Promise<PersistedReactiveCompactEvent[]> {
  const events: PersistedReactiveCompactEvent[] = []
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
    if (coerceNonEmptyString(parsed.name) !== 'reactive_compact_applied') continue
    const event = parseReactiveCompactEvent(parsed.ts, parsed.data)
    if (!event) continue
    events.push(event)
  }

  return events
}

export async function readLatestReactiveCompactEventFromSession(args: {
  filePath: string
}): Promise<PersistedReactiveCompactEvent | null> {
  const events = await scanReactiveCompactEvents(args.filePath)
  return events.length > 0 ? events[events.length - 1]! : null
}

export function readLatestReactiveCompactEventFromSessionSync(args: {
  filePath: string
}): PersistedReactiveCompactEvent | null {
  let latest: PersistedReactiveCompactEvent | null = null
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
    if (coerceNonEmptyString(parsed.name) !== 'reactive_compact_applied') continue
    const event = parseReactiveCompactEvent(parsed.ts, parsed.data)
    if (!event) continue
    latest = event
  }
  return latest
}
