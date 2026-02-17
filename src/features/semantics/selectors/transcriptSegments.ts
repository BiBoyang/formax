import type { TranscriptSegment } from '../projection/transcriptProjection'

export function selectTurnSegments(segments: TranscriptSegment[], turnId: string): TranscriptSegment[] {
  return segments.filter((segment) => segment.turnId === turnId)
}

export function selectTailSegmentsForTurn(segments: TranscriptSegment[], turnId: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  let seenTurn = false

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (!segment) continue
    if (segment.turnId === turnId) {
      out.push(segment)
      seenTurn = true
      continue
    }
    if (seenTurn) break
  }

  return out.reverse()
}
