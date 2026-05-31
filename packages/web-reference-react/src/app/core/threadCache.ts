import type {
  CompactBoundarySummary,
  DurableSnipSummary,
  RequestCollapseSummary,
  SessionMemoryRestoreSummary,
  TranscriptItem,
} from '../../types'
import type { ThreadTranscriptSource } from './replayMachine'

export type ThreadCacheState = {
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  transcriptSourceByThreadId: Record<string, ThreadTranscriptSource>
  latestCompactBoundaryByThreadId: Record<string, CompactBoundarySummary | null>
  durableSnipByThreadId: Record<string, DurableSnipSummary | null>
  latestRequestCollapseByThreadId: Record<string, RequestCollapseSummary | null>
  pendingSessionMemoryRestoreByThreadId: Record<string, SessionMemoryRestoreSummary | null>
}

export type ThreadCompressionProjectionFacts = {
  latestCompactBoundary?: CompactBoundarySummary | null
  durableSnip?: DurableSnipSummary | null
  latestRequestCollapse?: RequestCollapseSummary | null
  pendingSessionMemoryRestore?: SessionMemoryRestoreSummary | null
}

export const INITIAL_THREAD_CACHE_STATE: ThreadCacheState = {
  logsByThreadId: {},
  historyCursorByThreadId: {},
  transcriptSourceByThreadId: {},
  latestCompactBoundaryByThreadId: {},
  durableSnipByThreadId: {},
  latestRequestCollapseByThreadId: {},
  pendingSessionMemoryRestoreByThreadId: {},
}

export function withThreadCacheSlice<K extends keyof ThreadCacheState>(
  cache: ThreadCacheState,
  key: K,
  nextSlice: ThreadCacheState[K],
): ThreadCacheState {
  if (cache[key] === nextSlice) return cache
  return {
    ...cache,
    [key]: nextSlice,
  }
}

export function withRecordValue<T>(record: Record<string, T>, key: string, value: T): Record<string, T> {
  if (record[key] === value) return record
  return {
    ...record,
    [key]: value,
  }
}

export function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return record
  const next = { ...record }
  delete next[key]
  return next
}
