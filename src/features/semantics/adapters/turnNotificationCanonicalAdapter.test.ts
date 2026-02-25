import { describe, expect, it } from 'vitest'
import { toCanonicalEventsFromTurnNotification } from './turnNotificationCanonicalAdapter'
import { createInitialTranscriptProjectionState, reduceTranscriptProjection } from '../projection/transcriptProjection'

describe('turnNotificationCanonicalAdapter', () => {
  it('maps turn/started input text into canonical user message', () => {
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1', status: 'running', mode: 'normal' },
          input: { text: 'hello from turn started' },
          replaySeq: 5,
          eventId: 'evt-5',
          ts: '2026-02-25T00:00:00.000Z',
          source: 'system',
        },
      },
      { fallbackThreadId: 'thread-fallback', requireEnvelope: true },
    )

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'user_message',
        threadId: 'thread-1',
        turnId: 'turn-1',
        replaySeq: 5,
        text: 'hello from turn started',
        source: 'system',
      }),
    ])
  })

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

  it('ignores complete/error payloads in turn/event notifications', () => {
    const completeEvents = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 9,
          event: { type: 'complete' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const errorEvents = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 10,
          event: { type: 'error', error: { message: 'boom' } },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(completeEvents).toEqual([])
    expect(errorEvents).toEqual([])
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

  it('rejects canonical projection when strict envelope is enabled and fields are missing', () => {
    const issues: Array<{ method: string; missing: string[] }> = []
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 1,
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          issues.push(issue)
        },
      },
    )

    expect(events).toEqual([])
    expect(issues).toEqual([{ method: 'turn/event', missing: ['eventId', 'ts', 'source'] }])
  })

  it('rejects strict envelope when schemaVersion is invalid', () => {
    const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const events = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 1,
          eventId: 'event-1',
          ts: '2026-02-10T00:00:00.000Z',
          source: 'engine',
          schemaVersion: 99,
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          issues.push(issue)
        },
      },
    )

    expect(events).toEqual([])
    expect(issues).toEqual([{ method: 'turn/event', missing: [], invalid: ['schemaVersion'] }])
  })

  it('rejects strict envelope with invalid schemaVersion across finalize methods', () => {
    const cases: Array<{
      method: 'turn/completed' | 'turn/failed'
      params: Record<string, unknown>
    }> = [
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 2,
          eventId: 'evt-2',
          ts: '2026-02-10T00:00:00.000Z',
          source: 'engine',
          schemaVersion: 99,
        },
      },
      {
        method: 'turn/failed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-2', threadId: 'thread-1', status: 'failed' },
          replaySeq: 3,
          eventId: 'evt-3',
          ts: '2026-02-10T00:00:01.000Z',
          source: 'engine',
          schemaVersion: 99,
          error: 'boom',
        },
      },
    ]

    for (const fixture of cases) {
      const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
      const events = toCanonicalEventsFromTurnNotification(
        {
          method: fixture.method,
          params: fixture.params,
        },
        {
          fallbackThreadId: 'thread-fallback',
          requireEnvelope: true,
          onInvalidEnvelope(issue) {
            issues.push(issue)
          },
        },
      )
      expect(events).toEqual([])
      expect(issues).toEqual([{ method: fixture.method, missing: [], invalid: ['schemaVersion'] }])
    }
  })

  it('enforces strict envelope consistently across turn notification methods', () => {
    const fixtures: Array<{
      method: 'turn/event' | 'turn/completed' | 'turn/failed' | 'turn/inputRequested' | 'turn/inputResolved'
      params: Record<string, unknown>
    }> = [
      {
        method: 'turn/event',
        params: {
          replaySeq: 1,
          threadId: 'thread-1',
          turnId: 'turn-1',
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 2,
          threadId: 'thread-1',
          turn: { id: 'turn-2', threadId: 'thread-1' },
        },
      },
      {
        method: 'turn/failed',
        params: {
          replaySeq: 3,
          threadId: 'thread-1',
          turn: { id: 'turn-3', threadId: 'thread-1', status: 'failed' },
          error: 'boom',
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 4,
          threadId: 'thread-1',
          turnId: 'turn-4',
          input: {
            inputId: 'input-1',
            threadId: 'thread-1',
            turnId: 'turn-4',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          replaySeq: 5,
          threadId: 'thread-1',
          turnId: 'turn-5',
          input: {
            inputId: 'input-2',
            threadId: 'thread-1',
            turnId: 'turn-5',
            toolUseId: 'tool-2',
            kind: 'approval',
            status: 'submitted',
            payload: { toolName: 'Write' },
          },
        },
      },
    ]

    for (const fixture of fixtures) {
      const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
      const events = toCanonicalEventsFromTurnNotification(
        {
          method: fixture.method,
          params: fixture.params,
        },
        {
          fallbackThreadId: 'thread-fallback',
          requireEnvelope: true,
          onInvalidEnvelope(issue) {
            issues.push(issue)
          },
        },
      )
      expect(events).toEqual([])
      expect(issues).toEqual([
        {
          method: fixture.method,
          missing: ['eventId', 'ts', 'source'],
        },
      ])
    }
  })

  it('allows strict envelope when required fields are present for all turn notification methods', () => {
    const fixtures: Array<{
      method: 'turn/event' | 'turn/completed' | 'turn/failed' | 'turn/inputRequested' | 'turn/inputResolved'
      params: Record<string, unknown>
    }> = [
      {
        method: 'turn/event',
        params: {
          replaySeq: 10,
          eventId: 'evt-10',
          ts: '2026-02-17T00:00:00.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-10',
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 11,
          eventId: 'evt-11',
          ts: '2026-02-17T00:00:01.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-11', threadId: 'thread-1' },
        },
      },
      {
        method: 'turn/failed',
        params: {
          replaySeq: 12,
          eventId: 'evt-12',
          ts: '2026-02-17T00:00:02.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-12', threadId: 'thread-1', status: 'failed' },
          error: 'boom',
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 13,
          eventId: 'evt-13',
          ts: '2026-02-17T00:00:03.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-13',
          input: {
            inputId: 'input-13',
            threadId: 'thread-1',
            turnId: 'turn-13',
            toolUseId: 'tool-13',
            kind: 'approval',
            status: 'pending',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          replaySeq: 14,
          eventId: 'evt-14',
          ts: '2026-02-17T00:00:04.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turnId: 'turn-14',
          input: {
            inputId: 'input-14',
            threadId: 'thread-1',
            turnId: 'turn-14',
            toolUseId: 'tool-14',
            kind: 'approval',
            status: 'submitted',
            payload: { toolName: 'Write' },
          },
        },
      },
    ]

    for (const fixture of fixtures) {
      const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
      const events = toCanonicalEventsFromTurnNotification(
        {
          method: fixture.method,
          params: fixture.params,
        },
        {
          fallbackThreadId: 'thread-fallback',
          requireEnvelope: true,
          onInvalidEnvelope(issue) {
            issues.push(issue)
          },
        },
      )
      expect(events.length).toBeGreaterThan(0)
      expect(issues).toEqual([])
    }
  })
})
