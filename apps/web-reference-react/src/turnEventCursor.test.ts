import { describe, expect, it } from 'vitest'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from './turnEventCursor'

describe('turnEventCursor', () => {
  it('deduplicates repeated eventIds', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' })).toBe(false)
  })

  it('drops out-of-order seq in the same trace and accepts increasing seq', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 1 })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 3 })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 2 })).toBe(false)
  })

  it('evicts old eventIds by cap and allows them again after eviction', () => {
    const cursor = createTurnEventCursorState(2)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-2' })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-3' })).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' })).toBe(true)
  })
})
