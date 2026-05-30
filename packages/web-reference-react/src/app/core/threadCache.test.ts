import { describe, expect, it } from 'vitest'
import {
  INITIAL_THREAD_CACHE_STATE,
  type ThreadCacheState,
  type ThreadCompressionProjectionFacts,
  withRecordValue,
  withThreadCacheSlice,
  withoutRecordKey,
} from './threadCache'
import { mergeCompactBoundarySummaryForCache } from './compactBoundarySummary'
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
    const currentBoundary = next.latestCompactBoundaryByThreadId[threadId] ?? null
    const nextBoundary = mergeCompactBoundarySummaryForCache(currentBoundary, facts.latestCompactBoundary)
    next = withThreadCacheSlice(
      next,
      'latestCompactBoundaryByThreadId',
      withRecordValue(next.latestCompactBoundaryByThreadId, threadId, nextBoundary),
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

  it('keeps nested preservedSegment facts when a later same-boundary payload omits optional details', () => {
    const deepBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-1',
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 3,
        preservedTailMessageCount: 2,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'tail-fp',
        messageFingerprints: ['summary-fp', 'head-fp', 'tail-fp'],
        messageIdentities: [
          { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
          { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
          { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
        ],
        summaryIdentity: { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
        headIdentity: { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
        anchorIdentity: { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
        tailIdentity: { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
      },
    }
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': deepBoundary },
    }

    const shallowPreservedSegmentBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-1',
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 3,
        preservedTailMessageCount: 2,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'tail-fp',
      },
    }

    const next = applyFactsForTest(cache, 'thread-1', { latestCompactBoundary: shallowPreservedSegmentBoundary })

    expect(next.latestCompactBoundaryByThreadId['thread-1']).toEqual(deepBoundary)
  })

  it('does not carry boundaryFingerprint into a raw payload that only matches preservedSegment core', () => {
    const fingerprintedBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-1',
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 2,
        preservedTailMessageCount: 1,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'tail-fp',
        tailFingerprint: 'tail-fp',
      },
    }
    const rawEventBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 2,
        preservedTailMessageCount: 1,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'tail-fp',
        tailFingerprint: 'tail-fp',
      },
    }
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': fingerprintedBoundary },
    }

    const next = applyFactsForTest(cache, 'thread-1', { latestCompactBoundary: rawEventBoundary })

    expect(next.latestCompactBoundaryByThreadId['thread-1']).toEqual(rawEventBoundary)
  })

  it('keeps cached deep inspection fields when a later same-boundary payload omits them', () => {
    const deepBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-1',
      keepStrategy: {
        kind: 'keep_combo',
        keepLastTurns: 3,
        keepMinTokens: 900,
        keepMinUserTurns: 2,
      },
      rehydrationPlan: {
        schemaVersion: 1,
        items: [{ kind: 'plan_state', priority: 'high', status: 'applied' }],
      },
      rehydrationCost: {
        sectionCount: 2,
        estimatedTokens: 144,
      },
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 2,
        preservedTailMessageCount: 1,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'tail-fp',
        tailFingerprint: 'tail-fp',
      },
    }
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': deepBoundary },
    }

    const next = applyFactsForTest(cache, 'thread-1', {
      latestCompactBoundary: { ...latestCompactBoundary, boundaryFingerprint: 'boundary-1' },
    })

    expect(next.latestCompactBoundaryByThreadId['thread-1']).toEqual(deepBoundary)
  })

  it('does not carry preservedSegment facts across a different compact boundary generation', () => {
    const deepBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-1',
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 2,
        preservedTailMessageCount: 1,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'head-fp',
      },
    }
    const newerShallowBoundary: CompactBoundarySummary = {
      ...latestCompactBoundary,
      boundaryFingerprint: 'boundary-2',
      preTokens: 8192,
    }
    const cache: ThreadCacheState = {
      ...INITIAL_THREAD_CACHE_STATE,
      latestCompactBoundaryByThreadId: { 'thread-1': deepBoundary },
    }

    const next = applyFactsForTest(cache, 'thread-1', { latestCompactBoundary: newerShallowBoundary })

    expect(next.latestCompactBoundaryByThreadId['thread-1']).toEqual(newerShallowBoundary)
  })
})
