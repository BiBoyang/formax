import type { TranscriptProjectionState, TranscriptSegment } from '../projection/transcriptProjection'

export type ProjectionSnapshot = Pick<
  TranscriptProjectionState,
  'segments' | 'lastReplaySeq' | 'toolNameByUseId' | 'openAssistantSegmentIdByTurn' | 'openThinkingSegmentIdByTurn'
>

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

export function selectProjectionSnapshot(
  projection: TranscriptProjectionState | null | undefined,
): ProjectionSnapshot | null {
  if (!projection) return null
  return {
    segments: projection.segments.map((segment) => ({ ...segment })),
    lastReplaySeq: projection.lastReplaySeq,
    toolNameByUseId: { ...projection.toolNameByUseId },
    openAssistantSegmentIdByTurn: { ...projection.openAssistantSegmentIdByTurn },
    openThinkingSegmentIdByTurn: { ...projection.openThinkingSegmentIdByTurn },
  }
}
