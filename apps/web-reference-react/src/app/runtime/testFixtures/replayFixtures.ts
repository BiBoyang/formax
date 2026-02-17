export const REPLAY_FIXTURE_THREAD_ID = 'thread-1'
export const REPLAY_FIXTURE_OTHER_THREAD_ID = 'thread-2'
export const REPLAY_FIXTURE_TURN_ID = 'turn-1'
export const REPLAY_FIXTURE_TS = '2026-02-17T00:00:00.000Z'

export type ReplayTurnEnvelope = {
  replaySeq: number
  eventId: string
  ts: string
  source: 'engine'
  threadId: string
  turnId: string
  event: { type: 'assistant_delta'; text: string }
}

export function createReplayTurnEventEnvelope(overrides: Partial<ReplayTurnEnvelope> = {}): ReplayTurnEnvelope {
  return {
    replaySeq: 11,
    eventId: 'evt-11',
    ts: REPLAY_FIXTURE_TS,
    source: 'engine',
    threadId: REPLAY_FIXTURE_THREAD_ID,
    turnId: REPLAY_FIXTURE_TURN_ID,
    event: { type: 'assistant_delta', text: 'hello from shared replay fixture' },
    ...overrides,
  }
}

export function createThreadScopedReplayRefsFixture() {
  return {
    replayCursorByThread: {
      [REPLAY_FIXTURE_THREAD_ID]: 10,
      [REPLAY_FIXTURE_OTHER_THREAD_ID]: 20,
    },
    replayAnomalyCountByThread: {
      [REPLAY_FIXTURE_THREAD_ID]: 1,
      [REPLAY_FIXTURE_OTHER_THREAD_ID]: 2,
    },
    runtimeStateByThread: {
      [REPLAY_FIXTURE_THREAD_ID]: { threadId: REPLAY_FIXTURE_THREAD_ID, mode: 'normal' },
      [REPLAY_FIXTURE_OTHER_THREAD_ID]: { threadId: REPLAY_FIXTURE_OTHER_THREAD_ID, mode: 'plan' },
    } as const,
  }
}

export function createArchiveSwitchThreadsFixture() {
  const activeThread = {
    id: 'active-thread',
    cwd: '/repo-a',
    updatedAt: '2026-02-13T00:00:00Z',
    label: 'Active',
  }
  const nextThread = {
    id: 'next-thread',
    cwd: '/repo-b',
    updatedAt: '2026-02-13T00:00:01Z',
    label: 'Next',
  }
  return {
    activeThread,
    nextThread,
    threads: [activeThread, nextThread],
  }
}
