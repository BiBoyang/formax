import { describe, expect, it } from 'vitest'
import {
  mapHistoryMessagesToCanonicalEvents,
  mapStreamEventToCanonicalEvents,
  mapTurnNotificationToCanonicalEvents,
} from './canonicalEventAdapter'
import { CROSS_PATH_CONTRACT_FIXTURE } from './crossPathContractFixture'

type NotificationEntry = (typeof CROSS_PATH_CONTRACT_FIXTURE.notifications)[number]

function normalizeReplayNotificationEntries(entries: readonly NotificationEntry[]): NotificationEntry[] {
  return entries
    .slice()
    .sort((left, right) => Number((left.params.replaySeq as number) ?? 0) - Number((right.params.replaySeq as number) ?? 0))
    .filter((entry, index, arr) => index === 0 || entry.params.replaySeq !== arr[index - 1]?.params.replaySeq)
}

describe('canonicalEventAdapter contract fixture', () => {
  it('keeps canonical contract stable across stream/notification/replay fixture paths', () => {
    const fixture = CROSS_PATH_CONTRACT_FIXTURE
    let replaySeq = 0

    const fromStream = fixture.streamEvents.flatMap((event) =>
      mapStreamEventToCanonicalEvents(event, {
        threadId: fixture.threadId,
        turnId: fixture.turnId,
        nextReplaySeq: () => {
          replaySeq += 1
          return replaySeq
        },
        now: () => fixture.ts,
      }),
    )
    const fromNotification = fixture.notifications.flatMap((notification) =>
      mapTurnNotificationToCanonicalEvents(notification, {
        fallbackThreadId: fixture.threadId,
        requireEnvelope: true,
      }),
    )
    const replayLikeEntries = [fixture.notifications[2], fixture.notifications[0], fixture.notifications[1], fixture.notifications[1], fixture.notifications[3]]
    const normalizedReplayEntries = normalizeReplayNotificationEntries(replayLikeEntries)
    const fromReplayNotifications = normalizedReplayEntries.flatMap((notification) =>
      mapTurnNotificationToCanonicalEvents(notification, {
        fallbackThreadId: fixture.threadId,
        requireEnvelope: true,
      }),
    )

    const normalize = (events: ReturnType<typeof mapStreamEventToCanonicalEvents>) =>
      events.map((event) => {
        if (event.kind === 'assistant_delta') {
          return { kind: event.kind, replaySeq: event.replaySeq, textDelta: event.textDelta }
        }
        if (event.kind === 'tool_event') {
          return {
            kind: event.kind,
            replaySeq: event.replaySeq,
            phase: event.phase,
            toolUseId: event.toolUseId,
            toolName: event.toolName ?? null,
            summary: event.summary ?? null,
          }
        }
        if (event.kind === 'turn_footer') {
          return { kind: event.kind, replaySeq: event.replaySeq, status: event.status }
        }
        return { kind: event.kind, replaySeq: event.replaySeq }
      })

    expect(normalize(fromStream)).toEqual(normalize(fromNotification))
    expect(normalize(fromReplayNotifications)).toEqual(normalize(fromNotification))
  })

  it('normalizes out-of-order duplicated replay notification entries before canonical mapping', () => {
    const fixture = CROSS_PATH_CONTRACT_FIXTURE
    const replayLikeEntries = [
      fixture.notifications[3],
      fixture.notifications[1],
      fixture.notifications[0],
      fixture.notifications[2],
      fixture.notifications[2],
      fixture.notifications[1],
    ]

    const normalizedReplayEntries = normalizeReplayNotificationEntries(replayLikeEntries)
    const canonicalFromReplayLike = normalizedReplayEntries.flatMap((notification) =>
      mapTurnNotificationToCanonicalEvents(notification, {
        fallbackThreadId: fixture.threadId,
        requireEnvelope: true,
      }),
    )
    const canonicalFromOrderedNotifications = fixture.notifications.flatMap((notification) =>
      mapTurnNotificationToCanonicalEvents(notification, {
        fallbackThreadId: fixture.threadId,
        requireEnvelope: true,
      }),
    )

    expect(normalizedReplayEntries.map((entry) => entry.params.replaySeq)).toEqual([1, 2, 3, 4])
    expect(canonicalFromReplayLike).toEqual(canonicalFromOrderedNotifications)
  })

  it('covers TUI stream path mapping', () => {
    let replaySeq = 0
    const ctx = {
      threadId: 'thread-stream',
      turnId: 'turn-stream',
      nextReplaySeq: () => {
        replaySeq += 1
        return replaySeq
      },
      now: () => '2026-02-17T00:00:00.000Z',
    }

    const events = [
      ...mapStreamEventToCanonicalEvents({ type: 'assistant_delta', text: 'hello' }, ctx),
      ...mapStreamEventToCanonicalEvents({ type: 'complete' }, ctx),
    ]

    expect(events.map((event) => event.kind)).toEqual(['assistant_delta', 'thinking_finalized', 'turn_footer'])
    expect(events.map((event) => event.replaySeq)).toEqual([1, 2, 3])
    expect(events[0]).toMatchObject({ threadId: 'thread-stream', turnId: 'turn-stream', source: 'engine' })
    expect(events[2]).toMatchObject({ kind: 'turn_footer', status: 'completed' })
  })

  it('covers app-server notification path mapping in strict envelope mode', () => {
    const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const events = mapTurnNotificationToCanonicalEvents(
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-notif',
          turn: { id: 'turn-notif', threadId: 'thread-notif' },
          replaySeq: 20,
          eventId: 'evt-20',
          ts: '2026-02-17T00:01:00.000Z',
          source: 'engine',
        },
      },
      {
        fallbackThreadId: 'fallback-thread',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          issues.push(issue)
        },
      },
    )

    expect(issues).toEqual([])
    expect(events.map((event) => event.kind)).toEqual(['thinking_finalized', 'turn_footer'])
    expect(events.map((event) => event.replaySeq)).toEqual([20, 21])
    expect(events[1]).toMatchObject({
      threadId: 'thread-notif',
      turnId: 'turn-notif',
      kind: 'turn_footer',
      status: 'completed',
      source: 'engine',
    })
  })

  it('covers Web history path mapping', () => {
    const events = mapHistoryMessagesToCanonicalEvents({
      threadId: 'thread-history',
      messages: [
        { id: 'msg-a', kind: 'message', role: 'assistant', text: 'from history' },
        { id: 'msg-t', kind: 'tool', toolName: 'Bash', status: 'completed', summary: 'done' },
      ],
    })

    expect(events.map((event) => event.kind)).toEqual(['assistant_delta', 'tool_event', 'tool_event'])
    expect(events[0]).toMatchObject({
      threadId: 'thread-history',
      turnId: 'history:thread-history:msg-a',
      kind: 'assistant_delta',
      textDelta: 'from history',
    })
    expect(events[2]).toMatchObject({
      threadId: 'thread-history',
      turnId: 'history:thread-history:msg-t',
      kind: 'tool_event',
      phase: 'end',
      summary: 'done',
    })
  })
})
