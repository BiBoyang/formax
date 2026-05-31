import { describe, expect, it } from 'vitest'
import {
  createTurnEventCursorState,
  resetSequencedNotificationOwner,
  shouldAcceptSequencedNotification,
} from './turnEventCursor'

const liveStreamOwner = { kind: 'live-stream' } as const
const threadReplayOwner = (threadId: string) => ({ kind: 'thread-replay', threadId }) as const

describe('turnEventCursor', () => {
  it('deduplicates repeated live eventIds', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' }, liveStreamOwner)).toBe(false)
  })

  it('drops out-of-order live seq in the same trace and accepts increasing seq', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 1 }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 3 }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { traceId: 't-1', seq: 2 }, liveStreamOwner)).toBe(false)
  })

  it('evicts old live eventIds by cap and allows them again after eviction', () => {
    const cursor = createTurnEventCursorState(2)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-2' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-3' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { eventId: 'e-1' }, liveStreamOwner)).toBe(true)
  })

  it('keeps live-stream replaySeq ordering global', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10, traceId: 't-1', seq: 9 }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 12, traceId: 't-2', seq: 1 }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 11, traceId: 't-3', seq: 99 }, liveStreamOwner)).toBe(false)
  })

  it('scopes thread replay ordering by replay owner', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 100 }, threadReplayOwner('thread-a'))).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1 }, threadReplayOwner('thread-b'))).toBe(true)
  })

  it('rejects stale replaySeq only within the same thread replay owner', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10 }, threadReplayOwner('thread-a'))).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10 }, threadReplayOwner('thread-a'))).toBe(false)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 9 }, threadReplayOwner('thread-a'))).toBe(false)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 9 }, threadReplayOwner('thread-b'))).toBe(true)
  })

  it('rejects thread replay entries without a usable replay scope', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1 }, threadReplayOwner(''))).toBe(false)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1 }, threadReplayOwner('   '))).toBe(false)
  })

  it('does not apply live event-id dedupe to thread replay hydration', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1, eventId: 'evt-shared' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1, eventId: 'evt-shared' }, threadReplayOwner('thread-a'))).toBe(true)
  })

  it('does not consume live eventId state when replaySeq rejection wins', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10, eventId: 'evt-10' }, liveStreamOwner)).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 9, eventId: 'evt-stale' }, liveStreamOwner)).toBe(false)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 11, eventId: 'evt-stale' }, liveStreamOwner)).toBe(true)
  })

  it('resets only the requested thread replay owner', () => {
    const cursor = createTurnEventCursorState(4)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10 }, threadReplayOwner('thread-a'))).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 10 }, threadReplayOwner('thread-b'))).toBe(true)

    resetSequencedNotificationOwner(cursor, threadReplayOwner('thread-a'))

    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1 }, threadReplayOwner('thread-a'))).toBe(true)
    expect(shouldAcceptSequencedNotification(cursor, { replaySeq: 1 }, threadReplayOwner('thread-b'))).toBe(false)
  })
})
