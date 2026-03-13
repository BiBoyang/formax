import { describe, expect, it } from 'vitest'
import { isNotificationForActiveThread } from './appEventMachine'

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
})
