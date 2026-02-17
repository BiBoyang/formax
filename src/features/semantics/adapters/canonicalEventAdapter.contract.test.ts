import { describe, expect, it } from 'vitest'
import {
  mapHistoryMessagesToCanonicalEvents,
  mapStreamEventToCanonicalEvents,
  mapTurnNotificationToCanonicalEvents,
} from './canonicalEventAdapter'

describe('canonicalEventAdapter contract fixture', () => {
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
