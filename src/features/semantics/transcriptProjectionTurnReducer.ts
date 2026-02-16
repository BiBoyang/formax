import type { CanonicalTurnFooterEvent } from './canonicalEvents'
import type { TranscriptSegmentIdFactory } from './transcriptProjectionIds'
import type { TranscriptSegment, TurnFooterSegment } from './transcriptProjectionTypes'

export function reduceTurnFooterEvent(args: {
  draft: {
    segments: TranscriptSegment[]
  }
  event: CanonicalTurnFooterEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
  const existingIndex = draft.segments.findIndex(
    (segment) => segment.kind === 'turn_footer' && segment.turnId === event.turnId,
  )

  if (existingIndex >= 0) {
    const current = draft.segments[existingIndex]
    if (current.kind === 'turn_footer') {
      draft.segments[existingIndex] = {
        ...current,
        status: event.status,
        ...(event.message ? { message: event.message } : {}),
      }
    }
    return
  }

  const next: TurnFooterSegment = {
    id: args.toSegmentId({ kind: 'turn_footer', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'turn_footer',
    turnId: event.turnId,
    status: event.status,
    ...(event.message ? { message: event.message } : {}),
  }
  draft.segments.push(next)
}
