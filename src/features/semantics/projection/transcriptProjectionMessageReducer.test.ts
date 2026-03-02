import { describe, expect, it } from 'vitest'
import { applyMessageProjectionEvent } from './transcriptProjectionMessageReducer'
import { createTranscriptSegmentId } from './transcriptProjectionIds'
import type { TranscriptSegment } from './transcriptProjectionTypes'

describe('transcriptProjectionMessageReducer', () => {
  it('returns skip_turn for empty user message without uiKind', () => {
    const draft = { segments: [] as TranscriptSegment[] }
    const outcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'user_message',
        threadId: 'thread-1',
        eventId: 'e1',
        replaySeq: 1,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        text: '',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(outcome).toBe('skip_turn')
    expect(draft.segments).toHaveLength(0)
  })

  it('appends non-empty user message without uiKind', () => {
    const draft = { segments: [] as TranscriptSegment[] }
    const outcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'user_message',
        threadId: 'thread-1',
        eventId: 'e-user-plain',
        replaySeq: 2,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        text: 'plain user',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(outcome).toBe('applied')
    expect(draft.segments[0]).toMatchObject({
      kind: 'user',
      text: 'plain user',
    })
    expect((draft.segments[0] as any).messageKind).toBeUndefined()
  })

  it('appends system segment for non-empty system message', () => {
    const draft = { segments: [] as TranscriptSegment[] }
    const outcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'system_message',
        threadId: 'thread-1',
        eventId: 'e2',
        replaySeq: 2,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        role: 'assistant',
        text: 'hello',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(outcome).toBe('applied')
    expect(draft.segments[0]).toMatchObject({
      kind: 'system',
      role: 'assistant',
      text: 'hello',
    })
  })

  it('appends user/system segments with uiKind and skips empty system message', () => {
    const draft = { segments: [] as TranscriptSegment[] }
    const userOutcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'user_message',
        threadId: 'thread-1',
        eventId: 'e-user-ui',
        replaySeq: 3,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        text: 'hi',
        uiKind: 'compact_summary',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(userOutcome).toBe('applied')
    expect(draft.segments[0]).toMatchObject({
      kind: 'user',
      text: 'hi',
      messageKind: 'compact_summary',
    })

    const systemOutcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'system_message',
        threadId: 'thread-1',
        eventId: 'e-system-ui',
        replaySeq: 4,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        role: 'assistant',
        text: 'sys',
        uiKind: 'compact_summary',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(systemOutcome).toBe('applied')
    expect(draft.segments[1]).toMatchObject({
      kind: 'system',
      text: 'sys',
      messageKind: 'compact_summary',
    })

    const skipSystem = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'system_message',
        threadId: 'thread-1',
        eventId: 'e-system-empty',
        replaySeq: 5,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        role: 'assistant',
        text: '',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(skipSystem).toBe('skip_turn')
  })

  it('ignores non-message events', () => {
    const draft = { segments: [] as TranscriptSegment[] }
    const outcome = applyMessageProjectionEvent({
      draft,
      event: {
        kind: 'assistant_delta',
        threadId: 'thread-1',
        eventId: 'e3',
        replaySeq: 3,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        textDelta: 'x',
      },
      toSegmentId: createTranscriptSegmentId,
    })
    expect(outcome).toBe('ignored')
    expect(draft.segments).toHaveLength(0)
  })
})
