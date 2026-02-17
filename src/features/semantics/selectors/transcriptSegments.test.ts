import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../projection/transcriptProjection'
import { selectTailSegmentsForTurn, selectTurnSegments } from './transcriptSegments'

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
})
