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

  it('resolves threadId/turnId from nested turn/input payloads and context source fallback', () => {
    const startedFromTurn = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          threadId: '   ',
          turn: { id: 'turn-from-turn', threadId: 'thread-from-turn' },
          input: { text: 'hello-turn-fallback' },
          replaySeq: 21,
          eventId: 'evt-21',
          ts: '2026-02-18T00:00:00.000Z',
          schemaVersion: 1,
        },
      },
      { fallbackThreadId: 'thread-fallback', source: 'ui' },
    )
    expect(startedFromTurn[0]).toMatchObject({
      threadId: 'thread-from-turn',
      turnId: 'turn-from-turn',
      source: 'ui',
      schemaVersion: 1,
    })

    const inputFromInputPayload = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: '   ',
          turnId: '   ',
          input: {
            inputId: 'in-1',
            threadId: 'thread-from-input',
            turnId: 'turn-from-input',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            payload: {},
          },
          replaySeq: 22,
          eventId: 'evt-22',
          ts: '2026-02-18T00:00:01.000Z',
        },
      },
      { fallbackThreadId: 'thread-fallback', source: 'policy' },
    )
    expect(inputFromInputPayload[0]).toMatchObject({
      kind: 'tool_input_state',
      threadId: 'thread-from-input',
      turnId: 'turn-from-input',
      source: 'policy',
    })
  })

  it('handles replay-seq fallback branches for single and paired events', () => {
    let seq = 100
    const nextReplaySeq = () => {
      seq += 1
      return seq
    }
    const single = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          event: { type: 'assistant_delta', text: 'delta' },
        },
      },
      { fallbackThreadId: 'thread-fallback', nextReplaySeq },
    )
    expect(single).toHaveLength(1)
    expect(single[0]?.replaySeq).toBe(101)

    let pairSeed = 5
    const nonMonotonicPair = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
        },
      },
      {
        fallbackThreadId: 'thread-fallback',
        nextReplaySeq: () => {
          if (pairSeed === 5) {
            pairSeed = 4
            return 5
          }
          return 4
        },
      },
    )
    expect(nonMonotonicPair.map((event) => event.replaySeq)).toEqual([5, 6])

    const completedWithoutSeq = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const failedWithoutSeq = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/failed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    expect(completedWithoutSeq).toEqual([])
    expect(failedWithoutSeq).toEqual([])
  })

  it('covers thinking delta text fallback chain (thinking -> text -> delta -> empty)', () => {
    const events = [
      toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 30,
            event: { type: 'thinking_delta', thinking: 'from-thinking' },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 31,
            event: { type: 'thinking_delta', text: 'from-text' },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 32,
            event: { type: 'thinking_delta', delta: 'from-delta' },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
      toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            replaySeq: 33,
            event: { type: 'thinking_delta' },
          },
        },
        { fallbackThreadId: 'thread-fallback' },
      ),
    ].flat()

    expect(events.map((event) => (event as any).textDelta)).toEqual(['from-thinking', 'from-text', 'from-delta'])
  })

  it('returns no events for invalid started/event/input payload shapes', () => {
    const startedNoSeq = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          input: { text: 'hi' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const startedNoText = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 40,
          input: { text: '   ' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const startedInputNotObject = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 41,
          input: 'hello',
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const eventNotObject = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 42,
          event: 'not-object',
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const eventTypeNotString = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 43,
          event: { type: 123 },
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const inputNoSeq = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          input: {
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
          },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const inputNotObject = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 44,
          input: 'bad',
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const inputBlankToolUseId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 45,
          input: {
            toolUseId: '   ',
            kind: 'approval',
            status: 'pending',
          },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const inputInvalidKind = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 46,
          input: {
            toolUseId: 'tool-1',
            kind: 'bad-kind',
            status: 'pending',
          },
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const inputInvalidStatus = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputResolved',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 47,
          input: {
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'bad-status',
          },
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(startedNoSeq).toEqual([])
    expect(startedNoText).toEqual([])
    expect(startedInputNotObject).toEqual([])
    expect(eventNotObject).toEqual([])
    expect(eventTypeNotString).toEqual([])
    expect(inputNoSeq).toEqual([])
    expect(inputNotObject).toEqual([])
    expect(inputBlankToolUseId).toEqual([])
    expect(inputInvalidKind).toEqual([])
    expect(inputInvalidStatus).toEqual([])
  })

  it('handles tool event/input details with id/name fallbacks and absent toolName payload', () => {
    const toolUpdate = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 50,
          event: { type: 'tool_update', toolUseId: 'tool-fallback', name: 'FallbackTool' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const toolInputStateNoName = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputResolved',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 51,
          input: {
            toolUseId: 'tool-fallback',
            kind: 'approval',
            status: 'submitted',
            payload: { toolName: '   ' },
          },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const toolInputStateWithNonStringUseId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputResolved',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 52,
          input: {
            toolUseId: 123,
            kind: 'approval',
            status: 'submitted',
          },
        } as any,
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(toolUpdate[0]).toMatchObject({
      kind: 'tool_event',
      toolUseId: 'tool-fallback',
      toolName: 'FallbackTool',
    })
    expect(toolInputStateNoName).toEqual([
      expect.not.objectContaining({
        toolName: expect.anything(),
      }),
    ])
    expect(toolInputStateWithNonStringUseId).toEqual([])
  })

  it('supports strict envelope fallback locations and reports full missing sets', () => {
    const validFromInput: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const inputEvents = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 60,
          eventId: 'evt-60',
          ts: '2026-02-18T00:00:03.000Z',
          source: 'engine',
          turnId: 'turn-from-input',
          input: {
            threadId: 'thread-from-input',
            turnId: 'turn-from-input',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
          },
        },
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          validFromInput.push(issue)
        },
      },
    )
    expect(inputEvents.length).toBe(1)
    expect(validFromInput).toEqual([])

    const unknownMethodIssues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const unknownMethodEvents = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/unknown',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 61,
          eventId: 'evt-61',
          ts: '2026-02-18T00:00:04.000Z',
          source: 'engine',
        },
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          unknownMethodIssues.push(issue)
        },
      },
    )
    expect(unknownMethodIssues).toEqual([])
    expect(unknownMethodEvents).toEqual([])

    const missingIssues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const missingEvents = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          threadId: '   ',
          turn: null,
          replaySeq: 0,
          eventId: '   ',
          ts: '   ',
          source: 'invalid-source',
        } as any,
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          missingIssues.push(issue)
        },
      },
    )
    expect(missingEvents).toEqual([])
    expect(missingIssues).toEqual([
      {
        method: 'turn/completed',
        missing: ['threadId', 'turnId', 'replaySeq', 'eventId', 'ts', 'source'],
      },
    ])
  })

  it('returns empty for notifications without resolvable turnId and for unsupported method fallback', () => {
    const noTurnId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-1',
          replaySeq: 70,
          event: { type: 'assistant_delta', text: 'hello' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const unsupportedMethod = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/modeChanged',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          replaySeq: 71,
          eventId: 'evt-71',
          ts: '2026-02-18T00:00:05.000Z',
          source: 'engine',
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    const failedDefaultStatus = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/failed',
        params: {
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1' },
          replaySeq: 72,
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )

    expect(noTurnId).toEqual([])
    expect(unsupportedMethod).toEqual([])
    expect(failedDefaultStatus[1]).toMatchObject({
      kind: 'turn_footer',
      status: 'failed',
      message: 'unknown',
    })
  })

  it('uses fallback threadId and infers failed status when turn object is absent', () => {
    const fallbackThread = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          turnId: 'turn-1',
          replaySeq: 80,
          event: { type: 'assistant_delta', text: 'from-fallback-thread' },
        },
      },
      { fallbackThreadId: 'thread-fallback-only' },
    )
    expect(fallbackThread[0]).toMatchObject({
      kind: 'assistant_delta',
      threadId: 'thread-fallback-only',
      turnId: 'turn-1',
    })

    const failedNoTurnObject = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/failed',
        params: {
          turnId: 'turn-1',
          replaySeq: 81,
          error: 'fatal',
        },
      },
      { fallbackThreadId: 'thread-fallback-only' },
    )
    expect(failedNoTurnObject[1]).toMatchObject({
      kind: 'turn_footer',
      status: 'failed',
      message: 'fatal',
    })
  })

  it('covers strict envelope nested turn/input edge branches', () => {
    const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []

    const strictFromTurn = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          replaySeq: 90,
          eventId: 'evt-90',
          ts: '2026-02-18T00:00:06.000Z',
          source: 'engine',
          turnId: 'turn-90',
          turn: { threadId: 'thread-90' },
          event: { type: 'assistant_delta', text: 'ok' },
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
    expect(strictFromTurn.length).toBe(1)

    const startedMissingTurnId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          replaySeq: 91,
          eventId: 'evt-91',
          ts: '2026-02-18T00:00:07.000Z',
          source: 'engine',
          threadId: 'thread-91',
          turn: { id: '   ', threadId: 'thread-91' },
          input: { text: 'hello' },
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
    expect(startedMissingTurnId).toEqual([])

    const completedMissingTurnId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/completed',
        params: {
          replaySeq: 92,
          eventId: 'evt-92',
          ts: '2026-02-18T00:00:08.000Z',
          source: 'engine',
          threadId: 'thread-92',
          turn: { id: '   ', threadId: 'thread-92' },
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
    expect(completedMissingTurnId).toEqual([])

    const inputMissingThreadId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 93,
          eventId: 'evt-93',
          ts: '2026-02-18T00:00:09.000Z',
          source: 'engine',
          turnId: 'turn-93',
          input: {
            threadId: '   ',
            turnId: 'turn-93',
            toolUseId: 'tool-93',
            kind: 'approval',
            status: 'pending',
          },
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
    expect(inputMissingThreadId).toEqual([])

    const eventMissingTurnId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          replaySeq: 94,
          eventId: 'evt-94',
          ts: '2026-02-18T00:00:10.000Z',
          source: 'engine',
          threadId: 'thread-94',
          event: { type: 'assistant_delta', text: 'x' },
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
    expect(eventMissingTurnId).toEqual([])

    expect(issues).toEqual([
      { method: 'turn/started', missing: ['turnId'] },
      { method: 'turn/completed', missing: ['turnId'] },
      { method: 'turn/inputRequested', missing: ['threadId'] },
      { method: 'turn/event', missing: ['turnId'] },
    ])

    const nonStrictInputTurnFallback = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/inputRequested',
        params: {
          threadId: 'thread-95',
          replaySeq: 95,
          input: {
            turnId: 'turn-from-input-nonstrict',
            toolUseId: 'tool-95',
            kind: 'approval',
            status: 'pending',
          },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    expect(nonStrictInputTurnFallback[0]).toMatchObject({
      turnId: 'turn-from-input-nonstrict',
    })
  })

  it('covers resolver false-path branches for nested turn/input ids', () => {
    const fallbackThreadEvent = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: '   ',
          turnId: 'turn-branch',
          turn: { threadId: '   ' },
          input: { threadId: '   ' },
          replaySeq: 96,
          event: { type: 'assistant_delta', text: 'fallback-thread' },
        },
      },
      { fallbackThreadId: 'thread-fallback-branch' },
    )
    expect(fallbackThreadEvent[0]).toMatchObject({
      kind: 'assistant_delta',
      threadId: 'thread-fallback-branch',
      turnId: 'turn-branch',
    })

    const unresolvedTurnId = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          threadId: 'thread-97',
          turn: { id: '   ' },
          input: { turnId: '   ' },
          replaySeq: 97,
          event: { type: 'assistant_delta', text: 'x' },
        },
      },
      { fallbackThreadId: 'thread-fallback' },
    )
    expect(unresolvedTurnId).toEqual([])

    const issues: Array<{ method: string; missing: string[]; invalid?: string[] }> = []
    const strictStartedWithoutTurnObject = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/started',
        params: {
          replaySeq: 98,
          eventId: 'evt-98',
          ts: '2026-02-18T00:00:11.000Z',
          source: 'engine',
          threadId: 'thread-98',
          turn: 'not-object',
          input: { text: 'x' },
        } as any,
      },
      {
        fallbackThreadId: 'thread-fallback',
        requireEnvelope: true,
        onInvalidEnvelope(issue) {
          issues.push(issue)
        },
      },
    )
    expect(strictStartedWithoutTurnObject).toEqual([])

    const strictEventMissingThread = toCanonicalEventsFromTurnNotification(
      {
        method: 'turn/event',
        params: {
          replaySeq: 99,
          eventId: 'evt-99',
          ts: '2026-02-18T00:00:12.000Z',
          source: 'engine',
          turnId: 'turn-99',
          turn: { threadId: '   ' },
          event: { type: 'assistant_delta', text: 'x' },
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
    expect(strictEventMissingThread).toEqual([])
    expect(issues).toEqual([
      { method: 'turn/started', missing: ['turnId'] },
      { method: 'turn/event', missing: ['threadId'] },
    ])
  })
})
