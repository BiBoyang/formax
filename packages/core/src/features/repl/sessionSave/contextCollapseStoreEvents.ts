import fs from 'node:fs'
import readline from 'node:readline'
import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  buildContextCollapseStoreSnapshot,
  createContextCollapseCommittedEntry,
  setContextCollapseStoreActiveCompactBoundaryFingerprint,
  type ContextCollapseCommittedEntry,
  type ContextCollapseCommittedRange,
  type ContextCollapseStoreSnapshot,
} from '../../../chat/context/contextCollapseStore'
import type { ContextCollapseMeta } from '../../../chat/context/contextCollapse'
import type { PromptMessage } from '../../../prompts'

export { CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME }

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

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

function parsePromptMessage(value: unknown): PromptMessage | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (!Array.isArray(value.content) || value.content.length === 0) return null
  return {
    role: value.role,
    content: value.content as any,
    ...(isObject(value.meta) ? { meta: value.meta as any } : {}),
  }
}

function parseContextCollapseMeta(value: unknown): ContextCollapseMeta | null {
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

function parseCommittedRange(value: unknown): ContextCollapseCommittedRange | null {
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

function parseContextCollapseCommittedEntry(ts: unknown, data: unknown): ContextCollapseCommittedEntry | null {
  if (!isObject(data)) return null
  const id = coerceNonEmptyString(data.id)
  if (!id || data.source !== 'request_collapse') return null
  const collapsedRange = parseCommittedRange(data.collapsedRange)
  const recapMessage = parsePromptMessage(data.recapMessage)
  const metadata = parseContextCollapseMeta(data.metadata)
  if (!collapsedRange || !recapMessage || !metadata) return null
  return createContextCollapseCommittedEntry({
    id,
    createdAtMs: parseCreatedAtMs(ts, data.createdAtMs),
    source: 'request_collapse',
    collapsedRange,
    compactBoundaryFingerprint: coerceNonEmptyString(data.compactBoundaryFingerprint),
    recapMessage,
    metadata,
  })
}

function readActiveCompactBoundaryFingerprint(record: unknown): string | null | undefined {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

async function readContextCollapseStoreFromSession(filePath: string): Promise<ContextCollapseStoreSnapshot> {
  let snapshot = buildContextCollapseStoreSnapshot({ entries: [] })
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
    const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(parsed)
    if (nextActiveCompactBoundaryFingerprint !== undefined) {
      snapshot = setContextCollapseStoreActiveCompactBoundaryFingerprint({
        snapshot,
        activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
      })
    }
    if (!isObject(parsed) || parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME) continue
    const entry = parseContextCollapseCommittedEntry(parsed.ts, parsed.data)
    if (entry) {
      snapshot = buildContextCollapseStoreSnapshot({
        entries: [...snapshot.entries, entry],
        activeCompactBoundaryFingerprint: snapshot.activeCompactBoundaryFingerprint,
      })
    }
  }

  return snapshot
}

export async function readContextCollapseStoreSnapshotFromSession(args: {
  filePath: string
}): Promise<ContextCollapseStoreSnapshot> {
  return readContextCollapseStoreFromSession(args.filePath)
}

export function readContextCollapseStoreSnapshotFromSessionSync(args: {
  filePath: string
}): ContextCollapseStoreSnapshot {
  let snapshot = buildContextCollapseStoreSnapshot({ entries: [] })
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return snapshot
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
    const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(parsed)
    if (nextActiveCompactBoundaryFingerprint !== undefined) {
      snapshot = setContextCollapseStoreActiveCompactBoundaryFingerprint({
        snapshot,
        activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
      })
    }
    if (!isObject(parsed) || parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME) continue
    const entry = parseContextCollapseCommittedEntry(parsed.ts, parsed.data)
    if (entry) {
      snapshot = buildContextCollapseStoreSnapshot({
        entries: [...snapshot.entries, entry],
        activeCompactBoundaryFingerprint: snapshot.activeCompactBoundaryFingerprint,
      })
    }
  }
  return snapshot
}
