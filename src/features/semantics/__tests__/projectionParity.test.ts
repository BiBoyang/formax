import { describe, expect, it } from 'vitest'
import { createInitialTranscriptProjectionState, reduceTranscriptProjection } from '../projection/transcriptProjection'
import { toCanonicalEventsFromStreamEvent } from '../adapters/streamCanonicalAdapter'
import { toCanonicalEventsFromTurnNotification } from '../adapters/turnNotificationCanonicalAdapter'

function normalizeSegments(segments: ReturnType<typeof createInitialTranscriptProjectionState>['segments']) {
  return segments.map((segment) => {
    if (segment.kind === 'user') {
      return {
        kind: 'user',
        turnId: segment.turnId,
        text: segment.text,
        ...(segment.uiKind ? { uiKind: segment.uiKind } : {}),
      }
    }
    if (segment.kind === 'system') {
      return {
        kind: 'system',
        turnId: segment.turnId,
        role: segment.role,
        text: segment.text,
        ...(segment.uiKind ? { uiKind: segment.uiKind } : {}),
      }
    }
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
        ...(segment.middleLines !== undefined ? { middleLines: segment.middleLines } : {}),
        ...(segment.transcriptLines !== undefined ? { transcriptLines: segment.transcriptLines } : {}),
        ...(segment.toolUses !== undefined ? { toolUses: segment.toolUses } : {}),
        ...(segment.usage !== undefined ? { usage: segment.usage } : {}),
        ...(segment.result !== undefined ? { result: segment.result } : {}),
        ...(segment.patchStartLineNumber !== undefined ? { patchStartLineNumber: segment.patchStartLineNumber } : {}),
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

  it('keeps local runtime envelope contract-equivalent to strict app-server notifications', () => {
    const threadId = 'thread-runtime-authoritative'
    const turnId = 'turn-runtime-authoritative'
    let streamSeq = 0

    const localEvents = [
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'local hello ' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        source: 'engine',
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'tool-1', name: 'Bash' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        source: 'tool',
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
          source: 'tool',
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'complete' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
        source: 'engine',
      }),
    ]

    expect(localEvents.every((event) => Boolean(event.threadId.trim()))).toBe(true)
    expect(localEvents.every((event) => event.replaySeq > 0)).toBe(true)
    expect(localEvents.every((event) => Boolean(event.eventId.trim()))).toBe(true)
    expect(localEvents.every((event) => Boolean(event.ts.trim()))).toBe(true)
    expect(localEvents.map((event) => event.source)).toEqual(['engine', 'tool', 'tool', 'engine', 'engine'])

    const strictServerEvents = [
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 1,
            eventId: 'srv-1',
            ts: '2026-02-17T00:00:01.000Z',
            source: 'engine',
            event: { type: 'assistant_delta', text: 'local hello ' },
          },
        },
        { fallbackThreadId: threadId, requireEnvelope: true },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 2,
            eventId: 'srv-2',
            ts: '2026-02-17T00:00:02.000Z',
            source: 'tool',
            event: { type: 'tool_start', id: 'tool-1', name: 'Bash' },
          },
        },
        { fallbackThreadId: threadId, requireEnvelope: true },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 3,
            eventId: 'srv-3',
            ts: '2026-02-17T00:00:03.000Z',
            source: 'tool',
            event: { type: 'tool_end', id: 'tool-1', result: { content: 'done', is_error: false } },
          },
        },
        { fallbackThreadId: threadId, requireEnvelope: true },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/completed',
          params: {
            threadId,
            turn: { id: turnId, threadId },
            replaySeq: 4,
            eventId: 'srv-4',
            ts: '2026-02-17T00:00:04.000Z',
            source: 'engine',
          },
        },
        { fallbackThreadId: threadId, requireEnvelope: true },
      ),
    ]

    const localProjection = localEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const strictServerProjection = strictServerEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )

    expect(normalizeSegments(localProjection.segments)).toEqual(normalizeSegments(strictServerProjection.segments))
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
        middleLines: ['OUT chunk 1'],
        result: 'done',
      },
      {
        kind: 'turn_footer',
        turnId,
        status: 'completed',
      },
    ])
  })

  it('keeps projection parity when a stale cursor rebuilds from snapshot plus tail events', () => {
    const threadId = 'thread-gap'
    const turnId = 'turn-gap'
    let streamSeq = 0

    const streamCanonicalEvents = [
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'hello ' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: 'world' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'tool-gap', name: 'Bash' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_end', id: 'tool-gap', result: { content: 'done', is_error: false, tool_use_id: 'tool-gap' } },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'assistant_delta', text: ' after tool' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
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
            replaySeq: 2,
            event: { type: 'assistant_delta', text: 'world' },
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
            event: { type: 'tool_start', id: 'tool-gap', name: 'Bash' },
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
            event: { type: 'tool_end', id: 'tool-gap', result: { content: 'done', is_error: false } },
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
            event: { type: 'assistant_delta', text: ' after tool' },
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
            replaySeq: 6,
          },
        },
        { fallbackThreadId: threadId },
      ),
    ]

    const streamFull = streamCanonicalEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const webFull = webCanonicalEvents.reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )

    const streamStaleClient = streamCanonicalEvents.slice(0, 1).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const webStaleClient = webCanonicalEvents.slice(0, 1).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    expect(normalizeSegments(streamStaleClient.segments)).not.toEqual(normalizeSegments(streamFull.segments))
    expect(normalizeSegments(webStaleClient.segments)).not.toEqual(normalizeSegments(webFull.segments))

    const streamSnapshot = streamCanonicalEvents.slice(0, 4).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )
    const webSnapshot = webCanonicalEvents.slice(0, 4).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      createInitialTranscriptProjectionState({ threadId }),
    )

    const streamRecovered = streamCanonicalEvents.slice(4).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      streamSnapshot,
    )
    const webRecovered = webCanonicalEvents.slice(4).reduce(
      (state, event) => reduceTranscriptProjection(state, event),
      webSnapshot,
    )

    expect(normalizeSegments(streamRecovered.segments)).toEqual(normalizeSegments(streamFull.segments))
    expect(normalizeSegments(webRecovered.segments)).toEqual(normalizeSegments(webFull.segments))
    expect(normalizeSegments(streamRecovered.segments)).toEqual(normalizeSegments(webRecovered.segments))
  })

  it('keeps parity for complex tool turns (Task + Edit + empty middleLines updates)', () => {
    const threadId = 'thread-complex'
    const turnId = 'turn-complex'
    let streamSeq = 0

    const streamCanonicalEvents = [
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'task-1', name: 'Task' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent(
        {
          type: 'tool_update',
          id: 'task-1',
          middleLines: ['task progress'],
          transcriptLines: ['task partial'],
          toolUses: 2,
          usage: { input_tokens: 9, output_tokens: 4 },
        },
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
        { type: 'tool_end', id: 'task-1', result: { content: '{"status":"running","task_id":"bg-1"}', is_error: false, tool_use_id: 'task-1' } },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'task-2', name: 'Task' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent(
        { type: 'tool_end', id: 'task-2', result: { content: 'Error: failed', is_error: true, tool_use_id: 'task-2' } },
        {
          threadId,
          turnId,
          nextReplaySeq: () => {
            streamSeq += 1
            return streamSeq
          },
        },
      ),
      ...toCanonicalEventsFromStreamEvent({ type: 'tool_start', id: 'edit-1', name: 'Edit' }, {
        threadId,
        turnId,
        nextReplaySeq: () => {
          streamSeq += 1
          return streamSeq
        },
      }),
      ...toCanonicalEventsFromStreamEvent(
        {
          type: 'tool_input',
          id: 'edit-1',
          input: { file_path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
        },
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
        { type: 'tool_update', id: 'edit-1', middleLines: ['@@ -1,1 +1,1 @@'] },
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
        { type: 'tool_update', id: 'edit-1', middleLines: [] },
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
        { type: 'tool_end', id: 'edit-1', result: { content: 'Done', is_error: false, tool_use_id: 'edit-1' } },
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
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 1, event: { type: 'tool_start', id: 'task-1', name: 'Task' } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 2,
            event: {
              type: 'tool_update',
              id: 'task-1',
              middleLines: ['task progress'],
              transcriptLines: ['task partial'],
              toolUses: 2,
              usage: { input_tokens: 9, output_tokens: 4 },
            },
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
            event: { type: 'tool_end', id: 'task-1', result: { content: '{"status":"running","task_id":"bg-1"}', is_error: false } },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 4, event: { type: 'tool_start', id: 'task-2', name: 'Task' } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 5, event: { type: 'tool_end', id: 'task-2', result: { content: 'Error: failed', is_error: true } } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 6, event: { type: 'tool_start', id: 'edit-1', name: 'Edit' } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        {
          method: 'turn/event',
          params: {
            threadId,
            turnId,
            replaySeq: 7,
            event: {
              type: 'tool_input',
              id: 'edit-1',
              input: { file_path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
            },
          },
        },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 8, event: { type: 'tool_update', id: 'edit-1', middleLines: ['@@ -1,1 +1,1 @@'] } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 9, event: { type: 'tool_update', id: 'edit-1', middleLines: [] } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/event', params: { threadId, turnId, replaySeq: 10, event: { type: 'tool_end', id: 'edit-1', result: { content: 'Done', is_error: false } } } },
        { fallbackThreadId: threadId },
      ),
      ...toCanonicalEventsFromTurnNotification(
        { method: 'turn/completed', params: { threadId, turn: { id: turnId, threadId }, replaySeq: 11 } },
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

    const normalized = normalizeSegments(streamProjection.segments)
    const edit = normalized.find((segment: any) => segment.kind === 'tool' && segment.toolUseId === 'edit-1')
    const taskError = normalized.find((segment: any) => segment.kind === 'tool' && segment.toolUseId === 'task-2')
    expect(edit).toMatchObject({
      kind: 'tool',
      toolName: 'Edit',
      status: 'completed',
      detailLines: ['@@ -1,1 +1,1 @@'],
      middleLines: ['@@ -1,1 +1,1 @@'],
    })
    expect(taskError).toMatchObject({
      kind: 'tool',
      toolName: 'Task',
      status: 'error',
      summary: 'Error: failed',
    })
  })
})
