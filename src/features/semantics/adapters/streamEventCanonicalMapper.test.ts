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
})
