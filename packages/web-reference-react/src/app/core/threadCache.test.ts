import { describe, expect, it } from 'vitest'
import {
  INITIAL_THREAD_CACHE_STATE,
  withRecordValue,
  withThreadCacheSlice,
  withoutRecordKey,
} from './threadCache'

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
})
