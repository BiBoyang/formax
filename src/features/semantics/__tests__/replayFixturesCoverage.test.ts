import { describe, expect, it } from 'vitest'
import {
  REPLAY_FIXTURE_OTHER_THREAD_ID,
  REPLAY_FIXTURE_THREAD_ID,
  createArchiveSwitchThreadsFixture,
  createReplayTurnEventEnvelope,
  createThreadScopedReplayRefsFixture,
} from '../../../../apps/web-reference-react/src/app/runtime/testFixtures/replayFixtures'

describe('web replay fixture helpers', () => {
  it('builds replay turn envelopes with defaults and overrides', () => {
    const base = createReplayTurnEventEnvelope()
    expect(base.threadId).toBe(REPLAY_FIXTURE_THREAD_ID)
    expect(base.source).toBe('engine')
    expect(base.event.type).toBe('assistant_delta')

    const overridden = createReplayTurnEventEnvelope({
      replaySeq: 999,
      eventId: 'evt-custom',
      threadId: REPLAY_FIXTURE_OTHER_THREAD_ID,
      event: { type: 'assistant_delta', text: 'custom' },
    })
    expect(overridden.replaySeq).toBe(999)
    expect(overridden.eventId).toBe('evt-custom')
    expect(overridden.threadId).toBe(REPLAY_FIXTURE_OTHER_THREAD_ID)
    expect(overridden.event.text).toBe('custom')
  })

  it('creates thread-scoped replay refs fixture', () => {
    const fixture = createThreadScopedReplayRefsFixture()
    expect(fixture.replayCursorByThread[REPLAY_FIXTURE_THREAD_ID]).toBe(10)
    expect(fixture.replayAnomalyCountByThread[REPLAY_FIXTURE_OTHER_THREAD_ID]).toBe(2)
    expect(fixture.runtimeStateByThread[REPLAY_FIXTURE_THREAD_ID].mode).toBe('normal')
    expect(fixture.runtimeStateByThread[REPLAY_FIXTURE_OTHER_THREAD_ID].mode).toBe('plan')
  })

  it('creates archive-switch fixture with active and next thread ordering', () => {
    const fixture = createArchiveSwitchThreadsFixture()
    expect(fixture.activeThread.id).toBe('active-thread')
    expect(fixture.nextThread.id).toBe('next-thread')
    expect(fixture.threads.map((thread) => thread.id)).toEqual(['active-thread', 'next-thread'])
  })
})
