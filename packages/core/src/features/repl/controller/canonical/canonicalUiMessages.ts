import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import type { CanonicalUiMessage } from '../send/sendTypes'

export function emitCanonicalUiMessageForTurn(args: {
  threadId: string
  turnId: string
  message: CanonicalUiMessage
  nextReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
  nowIso?: () => string
}): void {
  const replaySeq = args.nextReplaySeq()
  const ts = (args.nowIso ?? (() => new Date().toISOString()))()

  if (args.message.role === 'user' && (args.message.uiKind === undefined || args.message.uiKind === 'compact_summary')) {
    args.onCanonicalEvent({
      threadId: args.threadId,
      replaySeq,
      eventId: `${args.threadId}:${args.turnId}:user_message:${replaySeq}`,
      ts,
      source: 'ui',
      kind: 'user_message',
      turnId: args.turnId,
      text: args.message.content,
      ...(args.message.uiKind === 'compact_summary' ? { uiKind: 'compact_summary' } : {}),
    })
    return
  }

  args.onCanonicalEvent({
    threadId: args.threadId,
    replaySeq,
    eventId: `${args.threadId}:${args.turnId}:system_message:${replaySeq}`,
    ts,
    source: 'ui',
    kind: 'system_message',
    turnId: args.turnId,
    role: args.message.role,
    text: args.message.content,
    ...(args.message.uiKind ? { uiKind: args.message.uiKind } : {}),
  })
}

export function emitCanonicalTurnFooterForTurn(args: {
  threadId: string
  turnId: string
  status: 'completed' | 'failed' | 'interrupted'
  message?: string
  nextReplaySeq: () => number
  onCanonicalEvent: (event: CanonicalEvent) => void
  nowIso?: () => string
}): void {
  const replaySeq = args.nextReplaySeq()
  const ts = (args.nowIso ?? (() => new Date().toISOString()))()

  args.onCanonicalEvent({
    threadId: args.threadId,
    replaySeq,
    eventId: `${args.threadId}:${args.turnId}:turn_footer:${replaySeq}`,
    ts,
    source: 'ui',
    kind: 'turn_footer',
    turnId: args.turnId,
    status: args.status,
    ...(args.message ? { message: args.message } : {}),
  })
}
