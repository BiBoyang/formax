import { describe, expect, it } from 'vitest'
import { toCanonicalEventsFromTurnNotification } from './turnNotificationCanonicalAdapter'
import { createInitialTranscriptProjectionState, reduceTranscriptProjection } from './transcriptProjection'

describe('turnNotificationCanonicalAdapter', () => {
  it('maps turn/event tool sequence into canonical tool events', () => {
    const events = [
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 10,
            event: { type: 'tool_start', id: 'tool-1', name: 'Bash' },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 11,
            event: { type: 'tool_input', id: 'tool-1', input: { command: 'ls -la', cwd: '/repo' } },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 12,
            event: { type: 'tool_update', id: 'tool-1', middleLines: ['OUT total 1'] },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 13,
            event: {
              type: 'tool_end',
              id: 'tool-1',
              result: { content: 'done', is_error: false, tool_use_id: 'tool-1' },
            },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
    ]

    expect(events.map((event) => event.kind)).toEqual(['tool_event', 'tool_event', 'tool_event', 'tool_event'])
    expect(events.map((event) => event.replaySeq)).toEqual([10, 11, 12, 13])
    expect(events[0]).toMatchObject({
      kind: 'tool_event',
      phase: 'start',
      toolUseId: 'tool-1',
      toolName: 'Bash',
    })
    expect(events[1]).toMatchObject({
      kind: 'tool_event',
      phase: 'update',
      toolUseId: 'tool-1',
      paramsText: 'command="ls -la", cwd="/repo"',
    })
    expect(events[3]).toMatchObject({
      kind: 'tool_event',
      phase: 'end',
      summary: 'done',
    })
  })

  it('maps turn/failed to interrupted footer when message is abort-like', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/failed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 50,
          error: 'Request aborted by user',
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(events.map((event) => event.kind)).toEqual(['thinking_finalized', 'turn_footer'])
    expect(events[1]).toMatchObject({
      kind: 'turn_footer',
      status: 'interrupted',
    })
  })

  it('prefers turn.status for turn/failed footer status when provided', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/failed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1', status: 'interrupted' },
          replaySeq: 60,
          error: 'request stopped',
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(events[1]).toMatchObject({
      kind: 'turn_footer',
      status: 'interrupted',
    })
  })

  it('derives unique event ids for multi-event notifications when params.eventId exists', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 90,
          eventId: 'notif-complete-1',
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(events).toHaveLength(2)
    expect(events[0]?.eventId).not.toEqual(events[1]?.eventId)

    const projection = events.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId: 'thread-1' }),
    )
    expect(projection.segments).toHaveLength(1)
    expect(projection.segments[0]).toMatchObject({
      kind: 'turn_footer',
      status: 'completed',
    })
  })

  it('consumes nextReplaySeq twice for turn/completed when params.replaySeq is absent', () => {
    let seq = 40
    const nextReplaySeq = () => {
      seq += 1
      return seq
    }

    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
        },
      },
      { fallbackThreadId: 'thread-fallback', nextReplaySeq },
    )

    expect(events).toHaveLength(2)
    expect(events.map((event) => event.replaySeq)).toEqual([41, 42])
    expect(nextReplaySeq()).toBe(43)
  })

  it('returns no events when replaySeq is missing and nextReplaySeq is not provided', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(events).toEqual([])
  })

  it('uses params.source when context source is absent', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 70,
          source: 'policy',
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(events[0]).toMatchObject({
      kind: 'assistant_delta',
      source: 'policy',
    })
  })

  it('preserves tool input state transitions when interleaved with tool events', () => {
    const fixtures = [
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 1,
          event: { type: 'tool_start', id: 'tool-approve-1', name: 'Write' },
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 2,
          input: {
            inputId: 'input-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            toolUseId: 'tool-approve-1',
            kind: 'approval',
            status: 'pending',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 3,
          input: {
            inputId: 'input-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            toolUseId: 'tool-approve-1',
            kind: 'approval',
            status: 'submitted',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 4,
          event: {
            type: 'tool_end',
            id: 'tool-approve-1',
            result: { content: 'Wrote file', is_error: false, tool_use_id: 'tool-approve-1' },
          },
        },
      },
    ]

    const projection = fixtures
      .flatMap((notification) =>
        toCanonicalEventsFromTurnNotification(notification, { fallbackThreadId: 'thread-fallback' }),
      )
      .reduce(
        (state, event) => reduceTranscriptProjection(state, event),
        createInitialTranscriptProjectionState({ threadId: 'thread-1' }),
      )

    expect(projection.segments).toHaveLength(1)
    expect(projection.segments[0]).toMatchObject({
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'tool-approve-1',
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote file',
      inputState: {
        kind: 'approval',
        status: 'submitted',
      },
    })
  })
})
