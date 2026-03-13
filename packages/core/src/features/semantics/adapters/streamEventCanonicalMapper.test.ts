import { describe, expect, it } from 'vitest'
import { inferCanonicalFailureStatus } from './canonicalAdapterCommon'
import { toCanonicalEventsFromStreamPayload } from './streamEventCanonicalMapper'

function createEnvelopeFactory() {
  let replaySeq = 0
  return {
    nextReplaySeq: () => {
      replaySeq += 1
      return replaySeq
    },
    envelopeFor: ({ kind, replaySeq: seq }: { kind: any; replaySeq: number }) => ({
      threadId: 'thread-1',
      replaySeq: seq,
      eventId: `e:${kind}:${seq}`,
      ts: '2026-02-17T00:00:00.000Z',
      source: 'engine' as const,
    }),
  }
}

describe('streamEventCanonicalMapper', () => {
  it('returns empty list for invalid turn/type/payload combinations', () => {
    const base = createEnvelopeFactory()
    expect(
      toCanonicalEventsFromStreamPayload(
        { type: 'assistant_delta', text: 'x' },
        {
          turnId: '   ',
          nextReplaySeq: base.nextReplaySeq,
          envelopeFor: base.envelopeFor,
          inferFailureStatus: inferCanonicalFailureStatus,
        },
      ),
    ).toEqual([])
    expect(
      toCanonicalEventsFromStreamPayload(
        { text: 'x' },
        {
          turnId: 'turn-1',
          nextReplaySeq: base.nextReplaySeq,
          envelopeFor: base.envelopeFor,
          inferFailureStatus: inferCanonicalFailureStatus,
        },
      ),
    ).toEqual([])
    expect(
      toCanonicalEventsFromStreamPayload(
        { type: 'assistant_delta', text: '' },
        {
          turnId: 'turn-1',
          nextReplaySeq: base.nextReplaySeq,
          envelopeFor: base.envelopeFor,
          inferFailureStatus: inferCanonicalFailureStatus,
        },
      ),
    ).toEqual([])
  })

  it('maps assistant/thinking/complete/unknown events', () => {
    const base = createEnvelopeFactory()
    const assistant = toCanonicalEventsFromStreamPayload(
      { type: 'assistant_delta', text: 'hello' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const thinkingStop = toCanonicalEventsFromStreamPayload(
      { type: 'thinking_stop' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const complete = toCanonicalEventsFromStreamPayload(
      { type: 'complete' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const unknown = toCanonicalEventsFromStreamPayload(
      { type: 'unknown_event' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )

    expect(assistant).toMatchObject([{ kind: 'assistant_delta', textDelta: 'hello' }])
    expect(thinkingStop).toMatchObject([{ kind: 'thinking_finalized' }])
    expect(complete).toMatchObject([
      { kind: 'thinking_finalized' },
      { kind: 'turn_footer', status: 'completed' },
    ])
    expect(unknown).toEqual([])
  })

  it('filters empty deltas and tool events without ids', () => {
    const base = createEnvelopeFactory()
    const emptyAssistant = toCanonicalEventsFromStreamPayload(
      { type: 'assistant_delta' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const emptyThinking = toCanonicalEventsFromStreamPayload(
      { type: 'thinking_delta', text: 'ignored-without-resolver' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const missingToolId = toCanonicalEventsFromStreamPayload(
      { type: 'tool_update', line: 'x', middleLines: ['m'] },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )

    expect(emptyAssistant).toEqual([])
    expect(emptyThinking).toEqual([])
    expect(missingToolId).toEqual([])
  })

  it('supports thinking delta fallback resolvers', () => {
    const base = createEnvelopeFactory()
    const events = toCanonicalEventsFromStreamPayload(
      { type: 'thinking_delta', text: 'fallback-thinking' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
        resolveThinkingDeltaText: (event) => String(event.thinking ?? event.text ?? ''),
      },
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'thinking_delta',
      textDelta: 'fallback-thinking',
    })
  })

  it('supports default thinking delta mapping and empty thinking filtering', () => {
    const base = createEnvelopeFactory()
    const events = toCanonicalEventsFromStreamPayload(
      { type: 'thinking_delta', thinking: 'internal' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const empty = toCanonicalEventsFromStreamPayload(
      { type: 'thinking_delta', thinking: '' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    expect(events).toMatchObject([{ kind: 'thinking_delta', textDelta: 'internal' }])
    expect(empty).toEqual([])
  })

  it('maps tool_start/tool_input/tool_update with progress fields', () => {
    const base = createEnvelopeFactory()
    const start = toCanonicalEventsFromStreamPayload(
      { type: 'tool_start', id: 't1', name: 'Read', input: { file_path: 'a' } },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const inputNoName = toCanonicalEventsFromStreamPayload(
      { type: 'tool_input', id: 't1', name: 'Read', input: { file_path: 'a' } },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    const inputWithName = toCanonicalEventsFromStreamPayload(
      { type: 'tool_input', id: 't2', name: 'Read', input: { file_path: 'a' } },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
        includeToolNameOnNonStart: true,
      },
    )
    const update = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_update',
        id: 't1',
        line: 'line-1',
        middleLines: ['a'],
        transcriptLines: ['b'],
        nestedTools: [
          { id: 'n1', name: 'Nested', input: { q: 1 }, status: 'running' },
          { id: '', name: 'bad', status: 'running' },
        ],
        toolUses: 2,
        usage: { input_tokens: 3 },
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )

    expect(start[0]).toMatchObject({ kind: 'tool_event', phase: 'start', toolName: 'Read' })
    expect((inputNoName[0] as any).toolName).toBeUndefined()
    expect(inputWithName[0]).toMatchObject({ toolName: 'Read' })
    expect(update[0]).toMatchObject({
      phase: 'update',
      line: 'b',
      middleLines: ['a'],
      transcriptLines: ['b'],
      nestedTools: [{ id: 'n1', name: 'Nested', status: 'running' }],
      toolUses: 2,
      usage: { input_tokens: 3 },
    })
  })

  it('supports tool-end options for completed fallback and progress fields', () => {
    const base = createEnvelopeFactory()
    const events = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_end',
        id: 'tool-1',
        result: { is_error: false },
        middleLines: ['line-a'],
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
        includeCompletedSummaryFallbackOnToolEnd: true,
        includeToolProgressFieldsOnEnd: true,
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'tool_event',
      phase: 'end',
      summary: 'completed',
      middleLines: ['line-a'],
    })
  })

  it('passes patchStartLineNumber through to canonical tool_event', () => {
    const base = createEnvelopeFactory()
    const events = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_end',
        id: 'edit-1',
        patchStartLineNumber: 22,
        result: { is_error: false, content: 'ok' },
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'tool_event',
      phase: 'end',
      patchStartLineNumber: 22,
    })
  })

  it('supports tool_end options for isError inclusion and invalid patch numbers', () => {
    const base = createEnvelopeFactory()
    const alwaysInclude = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_end',
        toolUseId: 'edit-2',
        name: 'Edit',
        patchStartLineNumber: 0,
        result: { is_error: false, content: 42 },
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
        alwaysIncludeToolEndIsError: true,
      },
    )
    expect(alwaysInclude[0]).toMatchObject({
      phase: 'end',
      isError: false,
    })
    expect((alwaysInclude[0] as any).patchStartLineNumber).toBeUndefined()
    expect((alwaysInclude[0] as any).result).toBe('42')
  })

  it('maps error events with different message sources', () => {
    const base = createEnvelopeFactory()
    const objectError = toCanonicalEventsFromStreamPayload(
      { type: 'error', error: { message: 'object fail' } },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: () => 'failed',
      },
    )
    const stringError = toCanonicalEventsFromStreamPayload(
      { type: 'error', error: 'string fail' },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: () => 'interrupted',
      },
    )
    const unknownError = toCanonicalEventsFromStreamPayload(
      { type: 'error', error: 1 },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: () => 'failed',
      },
    )

    expect(objectError[1]).toMatchObject({ kind: 'turn_footer', message: 'object fail', status: 'failed' })
    expect(stringError[1]).toMatchObject({ kind: 'turn_footer', message: 'string fail', status: 'interrupted' })
    expect(unknownError[1]).toMatchObject({ kind: 'turn_footer', message: 'stream error', status: 'failed' })
  })

  it('handles malformed tool payload fields and Error instances', () => {
    const base = createEnvelopeFactory()
    const malformedUpdate = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_update',
        id: 'tool-raw',
        middleLines: ['m1'],
        nestedTools: [
          { id: 1, name: 'bad-id', status: 'running' },
          { id: 'x', name: '', status: 'running' },
          { id: 'y', name: 'bad-status', status: 'nope' },
          { id: 'ok', name: 'Nested', input: 'not-object', status: 'completed', summary: 'done' },
        ],
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    expect(malformedUpdate).toHaveLength(1)
    expect(malformedUpdate[0]).toMatchObject({
      phase: 'update',
      middleLines: ['m1'],
      nestedTools: [{ id: 'ok', name: 'Nested', input: {}, status: 'completed', summary: 'done' }],
    })

    const toolEndNoResultObject = toCanonicalEventsFromStreamPayload(
      { type: 'tool_end', id: 'tool-raw', result: null },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    expect(toolEndNoResultObject[0]).toMatchObject({ phase: 'end' })
    expect((toolEndNoResultObject[0] as any).result).toBeUndefined()
    expect((toolEndNoResultObject[0] as any).isError).toBeUndefined()

    const errorInstance = toCanonicalEventsFromStreamPayload(
      { type: 'error', error: new Error('boom') },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: () => 'failed',
      },
    )
    expect(errorInstance[1]).toMatchObject({ kind: 'turn_footer', message: 'boom', status: 'failed' })
  })

  it('handles empty nested-tools reductions and update payloads without middleLines', () => {
    const base = createEnvelopeFactory()
    const noMiddleLines = toCanonicalEventsFromStreamPayload(
      {
        type: 'tool_update',
        id: 'tool-no-mid',
        nestedTools: [{ id: 'n1', name: 1, status: 'running' }],
      },
      {
        turnId: 'turn-1',
        nextReplaySeq: base.nextReplaySeq,
        envelopeFor: base.envelopeFor,
        inferFailureStatus: inferCanonicalFailureStatus,
      },
    )
    expect(noMiddleLines).toHaveLength(1)
    expect(noMiddleLines[0]).toMatchObject({ kind: 'tool_event', phase: 'update' })
    expect((noMiddleLines[0] as any).middleLines).toBeUndefined()
    expect((noMiddleLines[0] as any).nestedTools).toBeUndefined()
  })
})
