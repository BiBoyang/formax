import { describe, expect, it } from 'vitest'
import { isNotificationForActiveThread, resolveNotificationReplaySeq } from './appEventMachine'

describe('appEventMachine', () => {
  it('matches notification against active thread id using threadId or turn.threadId', () => {
    expect(
      isNotificationForActiveThread({
        params: { threadId: 'thread-a' },
        activeThreadId: 'thread-a',
      }),
    ).toBe(true)
    expect(
      isNotificationForActiveThread({
        params: { turn: { threadId: 'thread-a' } },
        activeThreadId: 'thread-b',
      }),
    ).toBe(false)
  })

  it('falls back replay seq when params do not provide one', () => {
    expect(resolveNotificationReplaySeq({ replaySeqFromParams: 9, previousReplaySeq: 3 })).toBe(9)
    expect(resolveNotificationReplaySeq({ replaySeqFromParams: null, previousReplaySeq: 3 })).toBe(4)
  })
})
