import type { StreamEvent } from '../../streaming/types'
import type {
  CanonicalEvent,
  CanonicalEventEnvelope,
  CanonicalEventSource,
} from './canonicalEvents'

type StreamCanonicalContext = {
  threadId: string
  turnId: string
  nextReplaySeq: () => number
  source?: CanonicalEventSource
  now?: () => string
}

function toTimestamp(now?: () => string): string {
  const value = now?.()
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
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
    ts: toTimestamp(ctx.now),
    source: ctx.source ?? 'engine',
  }
}

function readToolUpdateLine(ev: Extract<StreamEvent, { type: 'tool_update' }>): string | undefined {
  if (Array.isArray(ev.transcriptLines) && ev.transcriptLines.length > 0) {
    const line = String(ev.transcriptLines[ev.transcriptLines.length - 1] ?? '').trim()
    if (line) return line
  }
  if (Array.isArray(ev.middleLines) && ev.middleLines.length > 0) {
    const line = String(ev.middleLines[ev.middleLines.length - 1] ?? '').trim()
    if (line) return line
  }
  if (typeof ev.toolUses === 'number') return `tool uses ${ev.toolUses}`
  return undefined
}

function readToolEndSummary(ev: Extract<StreamEvent, { type: 'tool_end' }>): string | undefined {
  const content = String(ev.result?.content ?? '').trim()
  if (content) return content
  if (ev.result?.is_error) return 'error'
  return 'completed'
}

function formatParamsText(input: unknown): string | undefined {
  if (input == null) return undefined
  try {
    const text = JSON.stringify(input)
    if (!text || text === '{}') return undefined
    return text.length > 220 ? `${text.slice(0, 220)}...` : text
  } catch {
    return undefined
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
    const paramsText = formatParamsText(ev.input)
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'update',
        ...(paramsText ? { paramsText } : {}),
      },
    ]
  }

  if (ev.type === 'tool_update') {
    const seq = replaySeq()
    const line = readToolUpdateLine(ev)
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'update',
        ...(line ? { line } : {}),
      },
    ]
  }

  if (ev.type === 'tool_end') {
    const seq = replaySeq()
    const summary = readToolEndSummary(ev)
    return [
      {
        ...createEnvelope(ctx, 'tool_event', seq),
        kind: 'tool_event',
        turnId: ctx.turnId,
        toolUseId: ev.id,
        phase: 'end',
        ...(summary ? { summary } : {}),
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
        status: 'failed',
        message: String(ev.error?.message ?? 'stream error'),
      },
    ]
  }

  return []
}
