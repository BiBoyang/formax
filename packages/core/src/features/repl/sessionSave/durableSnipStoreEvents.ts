import fs from 'node:fs'
import readline from 'node:readline'
import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import type { DurableSnipRemoval, DurableSnipState } from '../../../chat/context/contextProjection'
import type { PromptMessage } from '../../../prompts'

export const DURABLE_SNIP_COMMITTED_EVENT_NAME = 'durable_snip_applied'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    const normalized = coerceNonEmptyString(item)
    if (!normalized) return undefined
    out.push(normalized)
  }
  return out
}

function parseRemoval(value: unknown): DurableSnipRemoval | null {
  if (!isObject(value) || value.kind !== 'model_facing_index_range') return null
  if (typeof value.startIndex !== 'number' || typeof value.endIndexExclusive !== 'number') return null
  const startIndex = Math.floor(value.startIndex)
  const endIndexExclusive = Math.floor(value.endIndexExclusive)
  if (startIndex < 0 || endIndexExclusive <= startIndex) return null
  const removedMessageIds = parseStringList(value.removedMessageIds)
  const removedMessageFingerprints = parseStringList(value.removedMessageFingerprints)
  const reason = coerceNonEmptyString(value.reason)
  return {
    kind: 'model_facing_index_range',
    startIndex,
    endIndexExclusive,
    ...(reason ? { reason } : {}),
    ...(removedMessageIds ? { removedMessageIds } : {}),
    ...(removedMessageFingerprints ? { removedMessageFingerprints } : {}),
  }
}

function parseRemovals(value: unknown): DurableSnipRemoval[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(parseRemoval).filter((entry): entry is DurableSnipRemoval => Boolean(entry))
}

function readActiveCompactBoundaryFingerprint(record: unknown): string | null | undefined {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

function applyActiveCompactBoundaryFingerprint(args: {
  state: DurableSnipState
  activeCompactBoundaryFingerprint: string | null
}): DurableSnipState {
  if (
    args.activeCompactBoundaryFingerprint &&
    args.state.removals.length > 0 &&
    args.state.activeCompactBoundaryFingerprint !== args.activeCompactBoundaryFingerprint
  ) {
    return {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
      removals: [],
    }
  }
  return {
    ...args.state,
    activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
  }
}

function applyDurableSnipEvent(args: {
  state: DurableSnipState
  data: unknown
}): DurableSnipState {
  if (!isObject(args.data) || args.data.schemaVersion !== 1) return args.state
  if (args.data.source !== 'request_snip') return args.state
  const eventCompactBoundaryFingerprint = coerceNonEmptyString(args.data.compactBoundaryFingerprint)
  if (
    eventCompactBoundaryFingerprint &&
    args.state.activeCompactBoundaryFingerprint &&
    eventCompactBoundaryFingerprint !== args.state.activeCompactBoundaryFingerprint
  ) {
    return args.state
  }
  if (!eventCompactBoundaryFingerprint && args.state.activeCompactBoundaryFingerprint) return args.state
  const removals = parseRemovals(args.data.removals)
  if (!removals) return args.state
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint: args.state.activeCompactBoundaryFingerprint ?? eventCompactBoundaryFingerprint,
    removals,
  }
}

function readDurableSnipStateFromParsedLine(args: {
  state: DurableSnipState
  parsed: unknown
}): DurableSnipState {
  const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(args.parsed)
  let state = args.state
  if (nextActiveCompactBoundaryFingerprint !== undefined) {
    state = applyActiveCompactBoundaryFingerprint({
      state,
      activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
    })
  }
  if (!isObject(args.parsed) || args.parsed.type !== 'event') return state
  if (coerceNonEmptyString(args.parsed.name) !== DURABLE_SNIP_COMMITTED_EVENT_NAME) return state
  return applyDurableSnipEvent({ state, data: args.parsed.data })
}

export async function readDurableSnipStateFromSession(args: { filePath: string }): Promise<DurableSnipState> {
  let state: DurableSnipState = { schemaVersion: 1, activeCompactBoundaryFingerprint: null, removals: [] }
  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    try {
      state = readDurableSnipStateFromParsedLine({ state, parsed: JSON.parse(trimmed) })
    } catch {
      continue
    }
  }
  return state
}

export function readDurableSnipStateFromSessionSync(args: { filePath: string }): DurableSnipState {
  let state: DurableSnipState = { schemaVersion: 1, activeCompactBoundaryFingerprint: null, removals: [] }
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return state
  }
  for (const line of raw.split('\n')) {
    const trimmed = String(line).trim()
    if (!trimmed) continue
    try {
      state = readDurableSnipStateFromParsedLine({ state, parsed: JSON.parse(trimmed) })
    } catch {
      continue
    }
  }
  return state
}
