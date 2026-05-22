import fs from 'node:fs'
import readline from 'node:readline'
import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import type { DurableSnipRemoval, DurableSnipState } from '../../../chat/context/contextProjection'
import type { PromptMessageIdentity } from '../../../chat/context/compact'
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

function parsePromptMessageIdentity(value: unknown): PromptMessageIdentity | null {
  if (!isObject(value) || value.schemaVersion !== 1) return null
  const id = coerceNonEmptyString(value.id)
  const fingerprint = coerceNonEmptyString(value.fingerprint)
  const source = value.source === 'explicit' || value.source === 'legacy_fallback' ? value.source : null
  if (!id || !fingerprint || !source) return null
  const parentId = value.parentId === null || value.parentId === undefined ? null : coerceNonEmptyString(value.parentId)
  if (value.parentId !== null && value.parentId !== undefined && !parentId) return null
  return {
    schemaVersion: 1,
    id,
    parentId,
    fingerprint,
    source,
  }
}

function parsePromptMessageIdentities(value: unknown): PromptMessageIdentity[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: PromptMessageIdentity[] = []
  for (const item of value) {
    const identity = parsePromptMessageIdentity(item)
    if (!identity) return undefined
    out.push(identity)
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
  const removedMessageIdentities = parsePromptMessageIdentities(value.removedMessageIdentities)
  const reason = coerceNonEmptyString(value.reason)
  return {
    kind: 'model_facing_index_range',
    startIndex,
    endIndexExclusive,
    ...(reason ? { reason } : {}),
    ...(removedMessageIds ? { removedMessageIds } : {}),
    ...(removedMessageFingerprints ? { removedMessageFingerprints } : {}),
    ...(removedMessageIdentities ? { removedMessageIdentities } : {}),
  }
}

function parseRemovals(value: unknown): DurableSnipRemoval[] | undefined {
  if (!Array.isArray(value)) return undefined
  const removals: DurableSnipRemoval[] = []
  for (const item of value) {
    const removal = parseRemoval(item)
    if (!removal) return undefined
    removals.push(removal)
  }
  return removals
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
      baseProjectionFingerprint: args.state.baseProjectionFingerprint ?? null,
      sourceProjectionKind: args.state.sourceProjectionKind ?? null,
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
  const baseProjectionFingerprint = coerceNonEmptyString(args.data.baseProjectionFingerprint)
  const sourceProjectionKind =
    args.data.sourceProjectionKind === 'model_facing_baseline' ? args.data.sourceProjectionKind : null
  return {
    schemaVersion: 1,
    activeCompactBoundaryFingerprint: args.state.activeCompactBoundaryFingerprint ?? eventCompactBoundaryFingerprint,
    baseProjectionFingerprint: baseProjectionFingerprint ?? null,
    sourceProjectionKind,
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
