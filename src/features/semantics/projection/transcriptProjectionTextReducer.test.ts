import { describe, expect, it, vi } from 'vitest'
import { reduceAssistantDeltaEvent, reduceThinkingDeltaEvent } from './transcriptProjectionTextReducer'
import type { TranscriptSegment } from './transcriptProjectionTypes'

describe('transcriptProjectionTextReducer', () => {
  it('handles empty deltas and creates new assistant/thinking segments when no open id exists', () => {
    const draft = {
      segments: [] as TranscriptSegment[],
      openAssistantSegmentIdByTurn: {} as Record<string, string>,
      openThinkingSegmentIdByTurn: {} as Record<string, string>,
    }
    const closeThinkingSegment = vi.fn()
    const closeAssistantSegment = vi.fn()

    reduceAssistantDeltaEvent({
      draft,
      event: {
        kind: 'assistant_delta',
        threadId: 'thread-1',
        eventId: 'a-empty',
        replaySeq: 1,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        textDelta: '',
      },
      closeThinkingSegment,
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments).toHaveLength(0)
    expect(closeThinkingSegment).not.toHaveBeenCalled()

    reduceAssistantDeltaEvent({
      draft,
      event: {
        kind: 'assistant_delta',
        threadId: 'thread-1',
        eventId: 'a-new',
        replaySeq: 2,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        textDelta: 'hello',
      },
      closeThinkingSegment,
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments[0]).toMatchObject({ kind: 'assistant', text: 'hello' })
    expect(draft.openAssistantSegmentIdByTurn['turn-1']).toBe('assistant-2')

    reduceThinkingDeltaEvent({
      draft,
      event: {
        kind: 'thinking_delta',
        threadId: 'thread-1',
        eventId: 't-empty',
        replaySeq: 3,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-2',
        textDelta: '',
      },
      closeAssistantSegment,
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(closeAssistantSegment).not.toHaveBeenCalled()

    reduceThinkingDeltaEvent({
      draft,
      event: {
        kind: 'thinking_delta',
        threadId: 'thread-1',
        eventId: 't-new',
        replaySeq: 4,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-2',
        textDelta: 'reason',
      },
      closeAssistantSegment,
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments[1]).toMatchObject({ kind: 'thinking', text: 'reason', status: 'running' })
    expect(draft.openThinkingSegmentIdByTurn['turn-2']).toBe('thinking-4')
  })

  it('appends to existing open segment and falls back when open segment kind mismatches', () => {
    const draft = {
      segments: [
        { id: 'assistant-open', kind: 'assistant', turnId: 'turn-a', text: 'A' },
        { id: 'thinking-open', kind: 'thinking', turnId: 'turn-b', text: 'B', status: 'running' },
      ] as TranscriptSegment[],
      openAssistantSegmentIdByTurn: {
        'turn-a': 'assistant-open',
        'turn-x': 'thinking-open',
      } as Record<string, string>,
      openThinkingSegmentIdByTurn: {
        'turn-b': 'thinking-open',
        'turn-y': 'assistant-open',
      } as Record<string, string>,
    }

    reduceAssistantDeltaEvent({
      draft,
      event: {
        kind: 'assistant_delta',
        threadId: 'thread-1',
        eventId: 'a-append',
        replaySeq: 5,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-a',
        textDelta: '+',
      },
      closeThinkingSegment: () => {},
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments[0]).toMatchObject({ kind: 'assistant', text: 'A+' })

    reduceAssistantDeltaEvent({
      draft,
      event: {
        kind: 'assistant_delta',
        threadId: 'thread-1',
        eventId: 'a-mismatch',
        replaySeq: 6,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-x',
        textDelta: 'new',
      },
      closeThinkingSegment: () => {},
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments.at(-1)).toMatchObject({ kind: 'assistant', text: 'new' })

    reduceThinkingDeltaEvent({
      draft,
      event: {
        kind: 'thinking_delta',
        threadId: 'thread-1',
        eventId: 't-append',
        replaySeq: 7,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-b',
        textDelta: '+',
      },
      closeAssistantSegment: () => {},
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments[1]).toMatchObject({ kind: 'thinking', text: 'B+' })

    reduceThinkingDeltaEvent({
      draft,
      event: {
        kind: 'thinking_delta',
        threadId: 'thread-1',
        eventId: 't-mismatch',
        replaySeq: 8,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-y',
        textDelta: 'fresh',
      },
      closeAssistantSegment: () => {},
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })
    expect(draft.segments.at(-1)).toMatchObject({ kind: 'thinking', text: 'fresh', status: 'running' })
  })
})
