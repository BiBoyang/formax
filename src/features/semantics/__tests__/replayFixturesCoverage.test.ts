import { describe, expect, it } from 'vitest'

const WEB_REPLAY_FIXTURES_MODULE =
  '../../../../apps/web-reference-react/src/app/runtime/testFixtures/replayFixtures'

type WebReplayFixturesModule = {
  REPLAY_FIXTURE_THREAD_ID: string
  REPLAY_FIXTURE_OTHER_THREAD_ID: string
  createReplayTurnEventEnvelope: (overrides?: Record<string, unknown>) => {
    replaySeq: number
    eventId: string
    ts: string
    source: 'engine'
    threadId: string
    turnId: string
    event: { type: 'assistant_delta'; text: string }
  }
  createThreadScopedReplayRefsFixture: () => {
    replayCursorByThread: Record<string, number>
    replayAnomalyCountByThread: Record<string, number>
    runtimeStateByThread: Record<string, { threadId: string; mode: 'normal' | 'plan' }>
  }
  createArchiveSwitchThreadsFixture: () => {
    activeThread: { id: string }
    nextThread: { id: string }
    threads: Array<{ id: string }>
  }
}

async function loadWebReplayFixtures(): Promise<WebReplayFixturesModule> {
  return (await import(WEB_REPLAY_FIXTURES_MODULE)) as WebReplayFixturesModule
}

describe('web replay fixture helpers', () => {
  it('builds replay turn envelopes with defaults and overrides', async () => {
    const fixtures = await loadWebReplayFixtures()
    const base = fixtures.createReplayTurnEventEnvelope()
    expect(base.threadId).toBe(fixtures.REPLAY_FIXTURE_THREAD_ID)
    expect(base.source).toBe('engine')
    expect(base.event.type).toBe('assistant_delta')

    const overridden = fixtures.createReplayTurnEventEnvelope({
      replaySeq: 999,
      eventId: 'evt-custom',
      threadId: fixtures.REPLAY_FIXTURE_OTHER_THREAD_ID,
      event: { type: 'assistant_delta', text: 'custom' },
    })
    expect(overridden.replaySeq).toBe(999)
    expect(overridden.eventId).toBe('evt-custom')
    expect(overridden.threadId).toBe(fixtures.REPLAY_FIXTURE_OTHER_THREAD_ID)
    expect(overridden.event.text).toBe('custom')
  })

  it('creates thread-scoped replay refs fixture', async () => {
    const fixtures = await loadWebReplayFixtures()
    const fixture = fixtures.createThreadScopedReplayRefsFixture()
    expect(fixture.replayCursorByThread[fixtures.REPLAY_FIXTURE_THREAD_ID]).toBe(10)
    expect(fixture.replayAnomalyCountByThread[fixtures.REPLAY_FIXTURE_OTHER_THREAD_ID]).toBe(2)
    expect(fixture.runtimeStateByThread[fixtures.REPLAY_FIXTURE_THREAD_ID].mode).toBe('normal')
    expect(fixture.runtimeStateByThread[fixtures.REPLAY_FIXTURE_OTHER_THREAD_ID].mode).toBe('plan')
  })

  it('creates archive-switch fixture with active and next thread ordering', async () => {
    const fixtures = await loadWebReplayFixtures()
    const fixture = fixtures.createArchiveSwitchThreadsFixture()
    expect(fixture.activeThread.id).toBe('active-thread')
    expect(fixture.nextThread.id).toBe('next-thread')
    expect(fixture.threads.map((thread) => thread.id)).toEqual(['active-thread', 'next-thread'])
  })
})
