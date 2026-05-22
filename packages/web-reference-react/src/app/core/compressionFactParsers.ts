import type { CompactBoundarySummary, DurableSnipSummary, RequestCollapseSummary } from '../../types'
import { parseCompactBoundarySummary } from './compactBoundarySummary'

export type OptionalNullableCompressionFact<T> = {
  present: boolean
  value: T | null
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseOptionalNullableCompressionFact<T>(
  record: Record<string, unknown>,
  key: string,
  parseValue: (value: unknown) => T | null,
): OptionalNullableCompressionFact<T> | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { present: false, value: null }
  const value = record[key]
  if (value === null) return { present: true, value: null }
  const parsed = parseValue(value)
  return parsed ? { present: true, value: parsed } : null
}

export function parseLatestCompactBoundarySummary(value: unknown): CompactBoundarySummary | null {
  return parseCompactBoundarySummary(value)
}

export function parseLatestRequestCollapseSummary(value: unknown): RequestCollapseSummary | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const phase = record.phase === 'initial' || record.phase === 'reactive_retry' ? record.phase : null
  const collapsedHeadMessageCount = asFiniteNumber(record.collapsedHeadMessageCount)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const recapFingerprint =
    record.recapFingerprint === undefined
      ? undefined
      : typeof record.recapFingerprint === 'string' && record.recapFingerprint.trim()
        ? record.recapFingerprint
        : null
  if (!phase || collapsedHeadMessageCount == null || estimatedTokensSaved == null || recapFingerprint === null) {
    return null
  }
  return {
    phase,
    collapsedHeadMessageCount,
    estimatedTokensSaved,
    ...(recapFingerprint ? { recapFingerprint } : {}),
  }
}

export function parseDurableSnipSummary(value: unknown): DurableSnipSummary | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const stage = record.stage === 'snip' ? 'snip' : null
  const status = record.status === 'no_state' || record.status === 'active' ? record.status : null
  const applied = typeof record.applied === 'boolean' ? record.applied : null
  const reason = typeof record.reason === 'string' ? record.reason : null
  const removedMessageCount = asFiniteNumber(record.removedMessageCount)
  const droppedOrphanToolBlockCount = asFiniteNumber(record.droppedOrphanToolBlockCount)
  const removalRangeCount = asFiniteNumber(record.removalRangeCount)
  if (
    !stage ||
    !status ||
    applied == null ||
    reason == null ||
    removedMessageCount == null ||
    droppedOrphanToolBlockCount == null ||
    removalRangeCount == null
  ) {
    return null
  }
  return {
    stage,
    status,
    applied,
    reason,
    removedMessageCount,
    droppedOrphanToolBlockCount,
    removalRangeCount,
  }
}
