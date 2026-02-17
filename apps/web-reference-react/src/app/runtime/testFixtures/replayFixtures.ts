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
