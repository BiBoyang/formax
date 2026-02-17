import type { StreamEvent } from '../../../streaming/types'
import type {
  CanonicalEvent,
  CanonicalEventEnvelope,
  CanonicalEventSource,
} from '../core/canonicalEvents'
import { inferCanonicalFailureStatus, toCanonicalTimestamp } from './canonicalAdapterCommon'
import { toCanonicalEventsFromStreamPayload } from './streamEventCanonicalMapper'

export type StreamCanonicalContext = {
  threadId: string
  turnId: string
  nextReplaySeq: () => number
  source?: CanonicalEventSource
  now?: () => string
}

function toEventId(args: { threadId: string; turnId: string; replaySeq: number; kind: CanonicalEvent['kind'] }): string {
  return `${args.threadId}:${args.turnId}:${args.kind}:${args.replaySeq}`
}

function createEnvelope(
  ctx: StreamCanonicalContext,
  kind: CanonicalEvent['kind'],
  replaySeq: number,
): CanonicalEventEnvelope {
  return {
    threadId: ctx.threadId,
    replaySeq,
    eventId: toEventId({ threadId: ctx.threadId, turnId: ctx.turnId, replaySeq, kind }),
    ts: toCanonicalTimestamp(ctx.now),
    source: ctx.source ?? 'engine',
  }
}

export function toCanonicalEventsFromStreamEvent(ev: StreamEvent, ctx: StreamCanonicalContext): CanonicalEvent[] {
  if (!ctx.turnId.trim() || !ctx.threadId.trim()) return []
  return toCanonicalEventsFromStreamPayload(ev as unknown as Record<string, unknown>, {
    turnId: ctx.turnId,
    nextReplaySeq: () => ctx.nextReplaySeq(),
    envelopeFor: ({ kind, replaySeq }) => createEnvelope(ctx, kind, replaySeq),
    inferFailureStatus: inferCanonicalFailureStatus,
    resolveThinkingDeltaText: (event) => String(event.thinking ?? ''),
    alwaysIncludeToolEndIsError: true,
  })
}
