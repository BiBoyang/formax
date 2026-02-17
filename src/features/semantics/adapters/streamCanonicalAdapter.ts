import type { StreamEvent } from '../../../streaming/types'
import type {
  CanonicalEvent,
  CanonicalEventEnvelope,
  CanonicalEventSource,
} from '../core/canonicalEvents'
import { formatToolInputAsParamsText } from '../../tools/presentation/paramsText'
import { inferCanonicalFailureStatus, toCanonicalTimestamp } from './canonicalAdapterCommon'
import { readCanonicalToolEndSummary, readCanonicalToolUpdateLine } from './toolEventCanonicalFields'

type StreamCanonicalContext = {
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
  const replaySeq = () => ctx.nextReplaySeq()

  if (ev.type === 'assistant_delta') {
    if (!ev.text) return []
    const seq = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'assistant_delta', seq),
        kind: 'assistant_delta',
        turnId: ctx.turnId,
        textDelta: ev.text,
      },
    ]
  }

  if (ev.type === 'thinking_delta') {
    if (!ev.thinking) return []
    const seq = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'thinking_delta', seq),
        kind: 'thinking_delta',
        turnId: ctx.turnId,
        textDelta: ev.thinking,
      },
    ]
  }

  if (ev.type === 'thinking_stop') {
    const seq = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'thinking_finalized', seq),
        kind: 'thinking_finalized',
        turnId: ctx.turnId,
      },
    ]
  }

  if (ev.type === 'tool_start') {
    const seq = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'start',
        toolName: ev.name,
      },
    ]
  }

  if (ev.type === 'tool_input') {
    const seq = replaySeq()
    const paramsText = formatToolInputAsParamsText(ev.input)
    const input =
      ev.input && typeof ev.input === 'object' && !Array.isArray(ev.input)
        ? (ev.input as Record<string, unknown>)
        : undefined
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'update',
        ...(input ? { input } : {}),
        ...(paramsText ? { paramsText } : {}),
      },
    ]
  }

  if (ev.type === 'tool_update') {
    const seq = replaySeq()
    const line = readCanonicalToolUpdateLine(ev)
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'update',
        ...(line ? { line } : {}),
        ...(Array.isArray(ev.middleLines) ? { middleLines: ev.middleLines } : {}),
        ...(Array.isArray(ev.transcriptLines) ? { transcriptLines: ev.transcriptLines } : {}),
        ...(Array.isArray(ev.nestedTools) ? { nestedTools: ev.nestedTools } : {}),
        ...(typeof ev.toolUses === 'number' ? { toolUses: ev.toolUses } : {}),
        ...(ev.usage ? { usage: ev.usage } : {}),
      },
    ]
  }

  if (ev.type === 'tool_end') {
    const seq = replaySeq()
    const summary = readCanonicalToolEndSummary(ev)
    const result = String(ev.result?.content ?? '')
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'end',
        ...(summary ? { summary } : {}),
        ...(result ? { result } : {}),
        isError: Boolean(ev.result?.is_error),
      },
    ]
  }

  if (ev.type === 'complete') {
    const seqFinalize = replaySeq()
    const seqFooter = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'thinking_finalized', seqFinalize),
        kind: 'thinking_finalized',
        turnId: ctx.turnId,
      },
      {
        ...createEnvelope(ctx, 'turn_footer', seqFooter),
        kind: 'turn_footer',
        turnId: ctx.turnId,
        status: 'completed',
      },
    ]
  }

  if (ev.type === 'error') {
    const message = String(ev.error?.message ?? 'stream error')
    const seqFinalize = replaySeq()
    const seqFooter = replaySeq()
    return [
      {
        ...createEnvelope(ctx, 'thinking_finalized', seqFinalize),
        kind: 'thinking_finalized',
        turnId: ctx.turnId,
      },
      {
        ...createEnvelope(ctx, 'turn_footer', seqFooter),
        kind: 'turn_footer',
        turnId: ctx.turnId,
        status: inferCanonicalFailureStatus(message),
        message,
      },
    ]
  }

  return []
}
