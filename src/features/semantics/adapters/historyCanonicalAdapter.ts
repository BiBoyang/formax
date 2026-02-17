import type { CanonicalEvent } from '../core/canonicalEvents'

export type HistoryCanonicalMessage =
  | {
      id: string
      kind: 'message'
      role: 'user' | 'assistant'
      text: string
    }
  | {
      id: string
      kind: 'tool'
      toolUseId?: string
      toolName: string
      status: 'running' | 'completed' | 'error'
      summary: string
      paramsText?: string
      detailLines?: string[]
    }

function toHistoryTurnId(threadId: string, messageId: string): string {
  return `history:${threadId}:${messageId}`
}

function toHistoryEventId(args: {
  threadId: string
  messageId: string
  phase: string
  replaySeq: number
}): string {
  return `history:${args.threadId}:${args.messageId}:${args.phase}:${args.replaySeq}`
}

function toHistoryTimestamp(replaySeq: number): string {
  return new Date(replaySeq * 1000).toISOString()
}

export function toCanonicalEventsFromHistoryMessages(args: {
  threadId: string
  messages: HistoryCanonicalMessage[]
}): CanonicalEvent[] {
  const out: CanonicalEvent[] = []
  let replaySeq = 0
  for (const message of args.messages) {
    if (message.kind === 'message') {
      if (message.role !== 'assistant') continue
      replaySeq += 1
      out.push({
        kind: 'assistant_delta',
        threadId: args.threadId,
        turnId: toHistoryTurnId(args.threadId, message.id),
        textDelta: message.text,
        replaySeq,
        eventId: toHistoryEventId({
          threadId: args.threadId,
          messageId: message.id,
          phase: 'assistant',
          replaySeq,
        }),
        ts: toHistoryTimestamp(replaySeq),
        source: 'system',
      })
      continue
    }

    replaySeq += 1
    const baseToolEvent = {
      kind: 'tool_event' as const,
      threadId: args.threadId,
      turnId: toHistoryTurnId(args.threadId, message.id),
      toolUseId: message.toolUseId ?? `${args.threadId}:${message.id}`,
      toolName: message.toolName,
      replaySeq,
      eventId: toHistoryEventId({
        threadId: args.threadId,
        messageId: message.id,
        phase: 'tool_start',
        replaySeq,
      }),
      ts: toHistoryTimestamp(replaySeq),
      source: 'system' as const,
      phase: 'start' as const,
      paramsText: message.paramsText,
    }
    out.push(baseToolEvent)

    for (const line of message.detailLines ?? []) {
      replaySeq += 1
      out.push({
        ...baseToolEvent,
        replaySeq,
        eventId: toHistoryEventId({
          threadId: args.threadId,
          messageId: message.id,
          phase: 'tool_update',
          replaySeq,
        }),
        ts: toHistoryTimestamp(replaySeq),
        phase: 'update',
        line,
      })
    }

    replaySeq += 1
    out.push({
      ...baseToolEvent,
      replaySeq,
      eventId: toHistoryEventId({
        threadId: args.threadId,
        messageId: message.id,
        phase: 'tool_end',
        replaySeq,
      }),
      ts: toHistoryTimestamp(replaySeq),
      phase: 'end',
      summary: message.summary,
      isError: message.status === 'error',
    })
  }
  return out
}
