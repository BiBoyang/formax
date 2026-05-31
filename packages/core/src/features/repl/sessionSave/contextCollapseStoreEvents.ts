import fs from 'node:fs'
import readline from 'node:readline'
import { coerceNonEmptyString, isObject } from './validation'

export const CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME = 'context_collapse_committed'

export type ContextCollapseCommittedRangeDto = {
  kind: 'model_facing_index_range'
  startIndex: number
  endIndexExclusive: number
}

export type ContextCollapsePromptMessageDto = {
  role: 'user' | 'assistant'
  content: unknown[]
  meta?: Record<string, unknown>
}

export type ContextCollapseMetaDto = {
  schemaVersion: 1
  kind: 'request_recap'
  keepLastTurns: number
  preservedTailMessageCount: number
  retainedCompactSummary: boolean
  recentUserPromptCount: number
  recentFileCount: number
  earlierToolResultBlockCount: number
  recapFingerprint: string
}

export type ContextCollapseCommittedEventDto = {
  type: 'context_collapse_committed'
  id: string
  createdAtMs: number
  source: 'request_collapse'
  collapsedRange: ContextCollapseCommittedRangeDto
  compactBoundaryFingerprint: string | null
  recapMessage: ContextCollapsePromptMessageDto
  metadata: ContextCollapseMetaDto
}

export type ContextCollapseHistoryStateDto = {
  type: 'history_state'
  messages: ContextCollapsePromptMessageDto[]
}

export type ContextCollapseSessionRecordDto =
  | ContextCollapseCommittedEventDto
  | ContextCollapseHistoryStateDto

function parseCreatedAtMs(ts: unknown, value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof ts !== 'string') return 0
  const parsed = Date.parse(ts)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseNonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parsePromptMessageDto(value: unknown): ContextCollapsePromptMessageDto | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (!Array.isArray(value.content) || value.content.length === 0) return null
  return {
    role: value.role,
    content: value.content,
    ...(isObject(value.meta) ? { meta: value.meta as Record<string, unknown> } : {}),
  }
}

function parseHistoryPromptMessageDto(value: unknown): ContextCollapsePromptMessageDto | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (!Array.isArray(value.content)) return null
  return {
    role: value.role,
    content: value.content,
    ...(isObject(value.meta) ? { meta: value.meta as Record<string, unknown> } : {}),
  }
}

function parseContextCollapseMetaDto(value: unknown): ContextCollapseMetaDto | null {
  if (!isObject(value)) return null
  if (value.schemaVersion !== 1 || value.kind !== 'request_recap') return null
  const keepLastTurns = parseNonNegativeInt(value.keepLastTurns)
  const preservedTailMessageCount = parseNonNegativeInt(value.preservedTailMessageCount)
  const recentUserPromptCount = parseNonNegativeInt(value.recentUserPromptCount)
  const recentFileCount = parseNonNegativeInt(value.recentFileCount)
  const earlierToolResultBlockCount = parseNonNegativeInt(value.earlierToolResultBlockCount)
  const retainedCompactSummary = parseBool(value.retainedCompactSummary)
  const recapFingerprint = coerceNonEmptyString(value.recapFingerprint)
  if (
    keepLastTurns == null ||
    preservedTailMessageCount == null ||
    recentUserPromptCount == null ||
    recentFileCount == null ||
    earlierToolResultBlockCount == null ||
    retainedCompactSummary == null ||
    !recapFingerprint
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    kind: 'request_recap',
    keepLastTurns,
    preservedTailMessageCount,
    retainedCompactSummary,
    recentUserPromptCount,
    recentFileCount,
    earlierToolResultBlockCount,
    recapFingerprint,
  }
}

function parseCommittedRangeDto(value: unknown): ContextCollapseCommittedRangeDto | null {
  if (!isObject(value) || value.kind !== 'model_facing_index_range') return null
  const { startIndex, endIndexExclusive } = value
  if (typeof startIndex !== 'number' || typeof endIndexExclusive !== 'number') return null
  if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndexExclusive)) return null
  if (startIndex < 0 || endIndexExclusive <= startIndex) return null
  return {
    kind: 'model_facing_index_range',
    startIndex,
    endIndexExclusive,
  }
}

function parseContextCollapseCommittedEventDto(ts: unknown, data: unknown): ContextCollapseCommittedEventDto | null {
  if (!isObject(data)) return null
  const id = coerceNonEmptyString(data.id)
  if (!id || data.source !== 'request_collapse') return null
  const collapsedRange = parseCommittedRangeDto(data.collapsedRange)
  const recapMessage = parsePromptMessageDto(data.recapMessage)
  const metadata = parseContextCollapseMetaDto(data.metadata)
  if (!collapsedRange || !recapMessage || !metadata) return null
  return {
    type: 'context_collapse_committed',
    id,
    createdAtMs: parseCreatedAtMs(ts, data.createdAtMs),
    source: 'request_collapse',
    collapsedRange,
    compactBoundaryFingerprint: coerceNonEmptyString(data.compactBoundaryFingerprint),
    recapMessage,
    metadata,
  }
}

function parseHistoryStateDto(record: unknown): ContextCollapseHistoryStateDto | null {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return null
  return {
    type: 'history_state',
    messages: record.messages
      .map((message) => parseHistoryPromptMessageDto(message))
      .filter((message): message is ContextCollapsePromptMessageDto => Boolean(message)),
  }
}

function parseSessionRecord(record: unknown): ContextCollapseSessionRecordDto | null {
  const historyState = parseHistoryStateDto(record)
  if (historyState) return historyState

  if (!isObject(record) || record.type !== 'event') return null
  if (coerceNonEmptyString(record.name) !== CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME) return null
  return parseContextCollapseCommittedEventDto(record.ts, record.data)
}

export async function readContextCollapseSessionRecordsFromSession(args: {
  filePath: string
}): Promise<ContextCollapseSessionRecordDto[]> {
  const records: ContextCollapseSessionRecordDto[] = []
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

export function readContextCollapseSessionRecordsFromSessionSync(args: {
  filePath: string
}): ContextCollapseSessionRecordDto[] {
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return []
  }

  const records: ContextCollapseSessionRecordDto[] = []
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
