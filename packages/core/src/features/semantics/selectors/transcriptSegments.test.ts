import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../projection/transcriptProjection'
import {
  selectProjectionSnapshot,
  selectTailSegmentsForTurn,
  selectTurnSegments,
} from './transcriptSegments'
import { createInitialTranscriptProjectionState, reduceTranscriptProjection } from '../projection/transcriptProjection'
import type { CanonicalEvent } from '../core/canonicalEvents'

function segment(id: string, turnId: string): TranscriptSegment {
  return {
    id,
    kind: 'assistant',
    turnId,
    text: id,
  }
}

describe('transcriptSegments selectors', () => {
  it('selectTurnSegments returns all segments for the requested turn', () => {
    const segments = [segment('s1', 'turn-1'), segment('s2', 'turn-2'), segment('s3', 'turn-1')]
    expect(selectTurnSegments(segments, 'turn-1').map((item) => item.id)).toEqual(['s1', 's3'])
  })

  it('selectTailSegmentsForTurn returns the contiguous tail block for one turn', () => {
    const segments = [
      segment('s1', 'turn-1'),
      segment('s2', 'turn-2'),
      segment('s3', 'turn-2'),
      segment('s4', 'turn-3'),
      segment('s5', 'turn-2'),
      segment('s6', 'turn-2'),
    ]
    expect(selectTailSegmentsForTurn(segments, 'turn-2').map((item) => item.id)).toEqual(['s5', 's6'])
  })

  it('selectTailSegmentsForTurn tolerates sparse segment arrays', () => {
    const sparse = [] as TranscriptSegment[]
    sparse[1] = segment('s1', 'turn-1')
    sparse[2] = segment('s2', 'turn-2')
    sparse[3] = segment('s3', 'turn-2')
    expect(selectTailSegmentsForTurn(sparse, 'turn-2').map((item) => item.id)).toEqual(['s2', 's3'])
  })

  it('skips missing trailing entries while scanning backward', () => {
    const sparse = [] as TranscriptSegment[]
    sparse[1] = segment('s1', 'turn-1')
    sparse[2] = segment('s2', 'turn-2')
    sparse.length = 4 // keep index 3 as an intentional hole
    expect(selectTailSegmentsForTurn(sparse, 'turn-2').map((item) => item.id)).toEqual(['s2'])
  })

  it('returns empty when target turn does not exist', () => {
    const segments = [segment('s1', 'turn-1'), segment('s2', 'turn-3')]
    expect(selectTailSegmentsForTurn(segments, 'turn-2')).toEqual([])
  })

  it('selectProjectionSnapshot clones projection fields into a stable snapshot shape', () => {
    const base = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const event: CanonicalEvent = {
      kind: 'assistant_delta',
      threadId: 'thread-1',
      turnId: 'turn-1',
      replaySeq: 1,
      eventId: 'e1',
      ts: '2026-02-17T00:00:00.000Z',
      source: 'engine',
      textDelta: 'hello',
    }
    const projection = reduceTranscriptProjection(base, event)
    const snapshot = selectProjectionSnapshot(projection)
    expect(snapshot).not.toBeNull()
    expect(snapshot).toEqual({
      segments: projection.segments,
      lastReplaySeq: 1,
      toolNameByUseId: {},
      openAssistantSegmentIdByTurn: { 'turn-1': projection.openAssistantSegmentIdByTurn['turn-1'] },
      openThinkingSegmentIdByTurn: {},
    })
    expect(snapshot?.segments).not.toBe(projection.segments)
  })

  it('selectProjectionSnapshot returns null for missing projection', () => {
    expect(selectProjectionSnapshot(null)).toBeNull()
    expect(selectProjectionSnapshot(undefined)).toBeNull()
  })
})
