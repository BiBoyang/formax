import { describe, expect, it } from 'vitest'
import { applyMessageProjectionEvent } from './transcriptProjectionMessageReducer'
import type { TranscriptSegment } from './transcriptProjectionTypes'

function toSegmentId(args: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }): string {
  return args.suffix
    ? `${args.turnId}:${args.kind}:${args.replaySeq}:${args.suffix}`
    : `${args.turnId}:${args.kind}:${args.replaySeq}`
}

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
      toSegmentId,
    })
    expect(outcome).toBe('skip_turn')
    expect(draft.segments).toHaveLength(0)
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
      toSegmentId,
    })
    expect(outcome).toBe('applied')
    expect(draft.segments[0]).toMatchObject({
      kind: 'system',
      role: 'assistant',
      text: 'hello',
    })
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
      toSegmentId,
    })
    expect(outcome).toBe('ignored')
    expect(draft.segments).toHaveLength(0)
  })
})
