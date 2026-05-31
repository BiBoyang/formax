import fs from 'node:fs'
import readline from 'node:readline'
import { coerceNonEmptyString, isObject } from './validation'

export const DURABLE_SNIP_COMMITTED_EVENT_NAME = 'durable_snip_applied'

export type DurableSnipPromptMessageIdentityDto = {
  schemaVersion: 1
  id: string
  parentId: string | null
  fingerprint: string
  source: 'explicit' | 'legacy_fallback'
}

export type DurableSnipRemovalDto = {
  kind: 'model_facing_index_range'
  startIndex: number
  endIndexExclusive: number
  reason?: string
  removedMessageIds?: string[]
  removedMessageFingerprints?: string[]
  removedMessageIdentities?: DurableSnipPromptMessageIdentityDto[]
}

export type DurableSnipCommittedEventDto = {
  type: 'durable_snip_applied'
  schemaVersion: 1
  source: 'request_snip'
  compactBoundaryFingerprint: string | null
  baseProjectionFingerprint: string | null
  sourceProjectionKind?: string
  removals: DurableSnipRemovalDto[]
}

export type DurableSnipPromptMessageDto = {
  role: 'user' | 'assistant'
  content: unknown[]
  meta?: Record<string, unknown>
}

export type DurableSnipHistoryStateDto = {
  type: 'history_state'
  messages: DurableSnipPromptMessageDto[]
}

export type DurableSnipSessionRecordDto = DurableSnipCommittedEventDto | DurableSnipHistoryStateDto

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

function parsePromptMessageIdentity(value: unknown): DurableSnipPromptMessageIdentityDto | null {
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

function parsePromptMessageIdentities(value: unknown): DurableSnipPromptMessageIdentityDto[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: DurableSnipPromptMessageIdentityDto[] = []
  for (const item of value) {
    const identity = parsePromptMessageIdentity(item)
    if (!identity) return undefined
    out.push(identity)
  }
  return out
}

function parseRemoval(value: unknown): DurableSnipRemovalDto | null {
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

function parseRemovals(value: unknown): DurableSnipRemovalDto[] | undefined {
  if (!Array.isArray(value)) return undefined
  const removals: DurableSnipRemovalDto[] = []
  for (const item of value) {
    const removal = parseRemoval(item)
    if (!removal) return undefined
    removals.push(removal)
  }
  return removals
}

function parseHistoryPromptMessageDto(value: unknown): DurableSnipPromptMessageDto | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (!Array.isArray(value.content)) return null
  return {
    role: value.role,
    content: value.content,
    ...(isObject(value.meta) ? { meta: value.meta as Record<string, unknown> } : {}),
  }
}

function parseHistoryStateDto(record: unknown): DurableSnipHistoryStateDto | null {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return null
  return {
    type: 'history_state',
    messages: record.messages
      .map((message) => parseHistoryPromptMessageDto(message))
      .filter((message): message is DurableSnipPromptMessageDto => Boolean(message)),
  }
}

function parseDurableSnipCommittedEventDto(data: unknown): DurableSnipCommittedEventDto | null {
  if (!isObject(data) || data.schemaVersion !== 1) return null
  if (data.source !== 'request_snip') return null
  const removals = parseRemovals(data.removals)
  if (!removals) return null
  const sourceProjectionKind = coerceNonEmptyString(data.sourceProjectionKind)
  return {
    type: DURABLE_SNIP_COMMITTED_EVENT_NAME,
    schemaVersion: 1,
    source: 'request_snip',
    compactBoundaryFingerprint: coerceNonEmptyString(data.compactBoundaryFingerprint),
    baseProjectionFingerprint: coerceNonEmptyString(data.baseProjectionFingerprint),
    ...(sourceProjectionKind ? { sourceProjectionKind } : {}),
    removals,
  }
}

function parseSessionRecord(record: unknown): DurableSnipSessionRecordDto | null {
  const historyState = parseHistoryStateDto(record)
  if (historyState) return historyState

  if (!isObject(record) || record.type !== 'event') return null
  if (coerceNonEmptyString(record.name) !== DURABLE_SNIP_COMMITTED_EVENT_NAME) return null
  return parseDurableSnipCommittedEventDto(record.data)
}

export async function readDurableSnipSessionRecordsFromSession(args: {
  filePath: string
}): Promise<DurableSnipSessionRecordDto[]> {
  const records: DurableSnipSessionRecordDto[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
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
    const record = parseSessionRecord(parsed)
    if (record) records.push(record)
  }

  return records
}

export function readDurableSnipSessionRecordsFromSessionSync(args: {
  filePath: string
}): DurableSnipSessionRecordDto[] {
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return []
  }

  const records: DurableSnipSessionRecordDto[] = []
  for (const line of raw.split('\n')) {
    const trimmed = String(line).trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = parseSessionRecord(parsed)
    if (record) records.push(record)
  }
  return records
}
