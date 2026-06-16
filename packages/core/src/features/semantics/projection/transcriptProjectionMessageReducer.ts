import type {
  CanonicalEvent,
  CanonicalMessageUiKind,
  CanonicalSystemMessageEvent,
  CanonicalUserMessageEvent,
} from '../core/canonicalEvents'
import type { TranscriptSegmentIdFactory } from './transcriptProjectionIds'
import type { SystemSegment, TranscriptSegment, UserSegment } from './transcriptProjectionTypes'

export function shouldSkipMessageSegment(args: { text: string; messageKind?: CanonicalMessageUiKind }): boolean {
  return !args.text && !args.messageKind
}

export function appendUserMessageSegment(args: {
  draft: { segments: TranscriptSegment[] }
  event: CanonicalUserMessageEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
  const next: UserSegment = {
    id: args.toSegmentId({ kind: 'user', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'user',
    turnId: event.turnId,
    text: event.text,
    ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
    ...(event.uiKind ? { messageKind: event.uiKind } : {}),
  }
  draft.segments.push(next)
}

export function appendSystemMessageSegment(args: {
  draft: { segments: TranscriptSegment[] }
  event: CanonicalSystemMessageEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
  const next: SystemSegment = {
    id: args.toSegmentId({ kind: 'system', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'system',
    turnId: event.turnId,
    role: event.role,
    text: event.text,
    ...(event.uiKind ? { messageKind: event.uiKind } : {}),
  }
  draft.segments.push(next)
}

export function applyMessageProjectionEvent(args: {
  draft: { segments: TranscriptSegment[] }
  event: CanonicalEvent
  toSegmentId: TranscriptSegmentIdFactory
}): 'ignored' | 'skip_turn' | 'applied' {
  const { event, draft, toSegmentId } = args
  if (event.kind === 'user_message') {
    if (shouldSkipMessageSegment({ text: event.text, messageKind: event.uiKind })) {
      return 'skip_turn'
    }
    appendUserMessageSegment({ draft, event, toSegmentId })
    return 'applied'
  }

  if (event.kind === 'system_message') {
    if (shouldSkipMessageSegment({ text: event.text, messageKind: event.uiKind })) {
      return 'skip_turn'
    }
    appendSystemMessageSegment({ draft, event, toSegmentId })
    return 'applied'
  }

  return 'ignored'
}
