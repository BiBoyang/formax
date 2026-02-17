import type { TranscriptSegment } from './transcriptProjectionTypes'

export type TranscriptLifecycleDraft = {
  segments: TranscriptSegment[]
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

function findOpenSegmentIndexById(segments: TranscriptSegment[], id: string | undefined): number {
  if (!id) return -1
  return segments.findIndex((segment) => segment.id === id)
}

export function closeAssistantSegment(draft: TranscriptLifecycleDraft, turnId: string): void {
  if (!Object.prototype.hasOwnProperty.call(draft.openAssistantSegmentIdByTurn, turnId)) return
  const next = { ...draft.openAssistantSegmentIdByTurn }
  delete next[turnId]
  draft.openAssistantSegmentIdByTurn = next
}

export function closeThinkingSegment(draft: TranscriptLifecycleDraft, turnId: string): void {
  const segmentId = draft.openThinkingSegmentIdByTurn[turnId]
  if (!segmentId) return
  const segmentIndex = findOpenSegmentIndexById(draft.segments, segmentId)
  if (segmentIndex >= 0) {
    const current = draft.segments[segmentIndex]
    if (current.kind === 'thinking' && current.status === 'running') {
      draft.segments[segmentIndex] = { ...current, status: 'finalized' }
    }
  }
  const next = { ...draft.openThinkingSegmentIdByTurn }
  delete next[turnId]
  draft.openThinkingSegmentIdByTurn = next
}

export function closeTurnTextSegments(draft: TranscriptLifecycleDraft, turnId: string): void {
  closeAssistantSegment(draft, turnId)
  closeThinkingSegment(draft, turnId)
}
