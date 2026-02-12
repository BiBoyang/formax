import { describe, expect, it } from 'vitest'
import { createInitialTranscriptProjectionState, reduceTranscriptProjection } from '../transcriptProjection'
import { toCanonicalEventsFromStreamEvent } from '../streamCanonicalAdapter'
import { toCanonicalEventsFromTurnNotification } from '../turnNotificationCanonicalAdapter'

function normalizeSegments(segments: ReturnType<typeof createInitialTranscriptProjectionState>['segments']) {
  return segments.map((segment) => {
    if (segment.kind === 'assistant') {
      return {
        kind: 'assistant',
        turnId: segment.turnId,
        text: segment.text,
      }
    }
    if (segment.kind === 'thinking') {
      return {
        kind: 'thinking',
        turnId: segment.turnId,
        text: segment.text,
        status: segment.status,
      }
    }
    if (segment.kind === 'tool') {
      return {
        kind: 'tool',
        turnId: segment.turnId,
        toolUseId: segment.toolUseId,
        toolName: segment.toolName,
        status: segment.status,
        summary: segment.summary,
        detailLines: segment.detailLines,
      }
    }
    return {
      kind: 'turn_footer',
      turnId: segment.turnId,
      status: segment.status,
      ...(segment.message ? { message: segment.message } : {}),
    }
  })
}

describe('projection parity', () => {
  it('produces equivalent projection from web notifications and tui stream events', () => {
    const threadId = 'thread-parity'
    const turnId = 'turn-1'

    let streamSeq = 0
    const streamCanonicalEvents = [
      ...toCanonicalEventsFromStreamEvent({ type: 'thinking_delta', thinking: 'analyze ' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'hello ' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'tool-1', name: 'Bash' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_update', id: 'tool-1', middleLines: ['OUT total 1'] }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_end', id: 'tool-1', result: { content: 'done', is_error: false, tool_use_id: 'tool-1' } },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
          now: () => '2026-02-13T00:00:00.000Z',
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'world' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'complete' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        now: () => '2026-02-13T00:00:00.000Z',
      }),
    ]

    const webCanonicalEvents = [
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 1,
            event: { type: 'thinking_delta', thinking: 'analyze ' },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 2,
            event: { type: 'assistant_delta', text: 'hello ' },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 3,
            event: { type: 'tool_start', id: 'tool-1', name: 'Bash' },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 4,
            event: { type: 'tool_update', id: 'tool-1', middleLines: ['OUT total 1'] },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 5,
            event: { type: 'tool_end', id: 'tool-1', result: { content: 'done', is_error: false } },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 6,
            event: { type: 'assistant_delta', text: 'world' },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/completed',
          params: {
            threadId,
            turn: { id: turnId, threadId },
            replaySeq: 7,
          },
        },
        { fallbackThreadId: threadId },
      ),
    ]

    const streamProjection = streamCanonicalEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const webProjection = webCanonicalEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )

    expect(normalizeSegments(streamProjection.segments)).toEqual(normalizeSegments(webProjection.segments))
  })

  it('keeps tool name sticky and dedupes duplicate canonical events consistently', () => {
    const threadId = 'thread-sticky'
    const turnId = 'turn-sticky'
    let streamSeq = 0

    const streamCanonicalEvents = [
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'tool-2', name: 'Write' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_update', id: 'tool-2', middleLines: ['OUT chunk 1'] },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
        },
      ),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_end', id: 'tool-2', result: { content: 'done', is_error: false, tool_use_id: 'tool-2' } },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'complete' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
    ]

    const webCanonicalEvents = [
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 1,
            eventId: 'sticky-1',
            event: { type: 'tool_start', id: 'tool-2', name: 'Write' },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 2,
            eventId: 'sticky-2',
            event: { type: 'tool_update', id: 'tool-2', middleLines: ['OUT chunk 1'] },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 3,
            eventId: 'sticky-3',
            event: { type: 'tool_end', id: 'tool-2', result: { content: 'done', is_error: false } },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/completed',
          params: {
            threadId,
            turn: { id: turnId, threadId },
            replaySeq: 4,
            eventId: 'sticky-4',
          },
        },
        { fallbackThreadId: threadId },
      ),
    ]

    const streamDuplicate = streamCanonicalEvents[1]
    const webDuplicate = webCanonicalEvents[1]
    if (!streamDuplicate || !webDuplicate) throw new Error('fixture error: missing duplicate target')

    const streamProjection = [...streamCanonicalEvents, streamDuplicate].reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const webProjection = [...webCanonicalEvents, webDuplicate].reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )

    expect(normalizeSegments(streamProjection.segments)).toEqual(normalizeSegments(webProjection.segments))
    expect(normalizeSegments(webProjection.segments)).toEqual([
      {
        kind: 'tool',
        turnId,
        toolUseId: 'tool-2',
        toolName: 'Write',
        status: 'completed',
        summary: 'done',
        detailLines: ['OUT chunk 1'],
      },
      {
        kind: 'turn_footer',
        turnId,
        status: 'completed',
      },
    ])
  })
})
