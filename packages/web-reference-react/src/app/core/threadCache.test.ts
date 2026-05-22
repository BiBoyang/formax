import { describe, expect, it } from 'vitest'
import {
  INITIAL_THREAD_CACHE_STATE,
  type ThreadCacheState,
  type ThreadCompressionProjectionFacts,
  withRecordValue,
  withThreadCacheSlice,
  withoutRecordKey,
} from './threadCache'
import type { CompactBoundarySummary, DurableSnipSummary, RequestCollapseSummary } from '../../types'

const latestCompactBoundary: CompactBoundarySummary = {
  schemaVersion: 1,
  trigger: 'manual',
  triggerReason: { kind: 'manual' },
  preTokens: 4096,
  summaryKind: 'model_summary',
}

const durableSnip: DurableSnipSummary = {
  stage: 'snip',
  status: 'active',
  applied: true,
  reason: 'applied durable snip removals',
  removedMessageCount: 2,
  droppedOrphanToolBlockCount: 0,
  removalRangeCount: 1,
}

const latestRequestCollapse: RequestCollapseSummary = {
  phase: 'initial',
  collapsedHeadMessageCount: 4,
  estimatedTokensSaved: 128,
  recapFingerprint: 'collapse-fp',
}

function applyFactsForTest(
  cache: ThreadCacheState,
  threadId: string,
  facts: ThreadCompressionProjectionFacts,
): ThreadCacheState {
  let next = cache
  if (facts.latestCompactBoundary !== undefined) {
    next = withThreadCacheSlice(
      next,
      'latestCompactBoundaryByThreadId',
      withRecordValue(next.latestCompactBoundaryByThreadId, threadId, facts.latestCompactBoundary),
    )
  }
  if (facts.durableSnip !== undefined) {
    next = withThreadCacheSlice(
      next,
      'durableSnipByThreadId',
      withRecordValue(next.durableSnipByThreadId, threadId, facts.durableSnip),
    )
  }
  if (facts.latestRequestCollapse !== undefined) {
    next = withThreadCacheSlice(
      next,
      'latestRequestCollapseByThreadId',
      withRecordValue(next.latestRequestCollapseByThreadId, threadId, facts.latestRequestCollapse),
    )
  }
  return next
}

describe('threadCache helpers', () => {
  it('withRecordValue keeps reference when value is unchanged', () => {
    const logs = [{ id: 'log-1' }]
    const record = { threadA: logs }

    const next = withRecordValue(record, 'threadA', logs)

    expect(next).toBe(record)
  })

  it('withRecordValue replaces key when value changes', () => {
    const record = { threadA: [1] }

    const next = withRecordValue(record, 'threadA', [2])

    expect(next).not.toBe(record)
    expect(next.threadA).toEqual([2])
  })

  it('withoutRecordKey keeps reference when key is absent', () => {
    const record = { threadA: true }

    const next = withoutRecordKey(record, 'threadB')

    expect(next).toBe(record)
  })

  it('withoutRecordKey removes key when present', () => {
    const record = { threadA: true, threadB: false }

    const next = withoutRecordKey(record, 'threadA')

    expect(next).not.toBe(record)
    expect(next).toEqual({ threadB: false })
  })

  it('withThreadCacheSlice keeps cache reference when slice is unchanged', () => {
    const next = withThreadCacheSlice(INITIAL_THREAD_CACHE_STATE, 'logsByThreadId', INITIAL_THREAD_CACHE_STATE.logsByThreadId)
    expect(next).toBe(INITIAL_THREAD_CACHE_STATE)
  })

  it('keeps cached compression facts when parsed facts are omitted', () => {
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': latestCompactBoundary },
      durableSnipByThreadId: { 'thread-1': durableSnip },
      latestRequestCollapseByThreadId: { 'thread-1': latestRequestCollapse },
    }

    const next = applyFactsForTest(cache, 'thread-1', {})

    expect(next).toBe(cache)
    expect(next.latestCompactBoundaryByThreadId['thread-1']).toEqual(latestCompactBoundary)
    expect(next.durableSnipByThreadId['thread-1']).toEqual(durableSnip)
    expect(next.latestRequestCollapseByThreadId['thread-1']).toEqual(latestRequestCollapse)
  })

  it('clears cached compression facts only for explicit null facts', () => {
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': latestCompactBoundary },
      durableSnipByThreadId: { 'thread-1': durableSnip },
      latestRequestCollapseByThreadId: { 'thread-1': latestRequestCollapse },
    }

    const next = applyFactsForTest(cache, 'thread-1', {
      latestCompactBoundary: null,
      durableSnip: null,
      latestRequestCollapse: null,
    })

    expect(next.latestCompactBoundaryByThreadId['thread-1']).toBeNull()
    expect(next.durableSnipByThreadId['thread-1']).toBeNull()
    expect(next.latestRequestCollapseByThreadId['thread-1']).toBeNull()
  })
})
