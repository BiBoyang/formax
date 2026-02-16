import type { CanonicalAssistantDeltaEvent, CanonicalThinkingDeltaEvent } from './canonicalEvents'
import type { AssistantSegment, ThinkingSegment, TranscriptSegment } from './transcriptProjection'

function findOpenSegmentIndexById(segments: TranscriptSegment[], id: string | undefined): number {
  if (!id) return -1
  return segments.findIndex((segment) => segment.id === id)
}

export function reduceAssistantDeltaEvent(args: {
  draft: {
    segments: TranscriptSegment[]
    openAssistantSegmentIdByTurn: Record<string, string>
  }
  event: CanonicalAssistantDeltaEvent
  closeThinkingSegment: (turnId: string) => void
  toSegmentId: (input: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }) => string
}): void {
  const { draft, event } = args
  const text = event.textDelta
  if (!text) return

  args.closeThinkingSegment(event.turnId)
  const openId = draft.openAssistantSegmentIdByTurn[event.turnId]
  const openIndex = findOpenSegmentIndexById(draft.segments, openId)
  if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'assistant') {
    const current = draft.segments[openIndex] as AssistantSegment
    draft.segments[openIndex] = { ...current, text: current.text + text }
    return
  }

  const next: AssistantSegment = {
    id: args.toSegmentId({ kind: 'assistant', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'assistant',
    turnId: event.turnId,
    text,
  }
  draft.segments.push(next)
  draft.openAssistantSegmentIdByTurn[event.turnId] = next.id
}

export function reduceThinkingDeltaEvent(args: {
  draft: {
    segments: TranscriptSegment[]
    openThinkingSegmentIdByTurn: Record<string, string>
  }
  event: CanonicalThinkingDeltaEvent
  closeAssistantSegment: (turnId: string) => void
  toSegmentId: (input: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }) => string
}): void {
  const { draft, event } = args
  const text = event.textDelta
  if (!text) return

  args.closeAssistantSegment(event.turnId)
  const openId = draft.openThinkingSegmentIdByTurn[event.turnId]
  const openIndex = findOpenSegmentIndexById(draft.segments, openId)
  if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'thinking') {
    const current = draft.segments[openIndex] as ThinkingSegment
    draft.segments[openIndex] = { ...current, text: current.text + text }
    return
  }

  const next: ThinkingSegment = {
    id: args.toSegmentId({ kind: 'thinking', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'thinking',
    turnId: event.turnId,
    text,
    status: 'running',
  }
  draft.segments.push(next)
  draft.openThinkingSegmentIdByTurn[event.turnId] = next.id
}
