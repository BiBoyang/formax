import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../../../src/features/semantics/transcriptProjection'
import type { CanonicalEvent } from '../../../src/features/semantics/canonicalEvents'
import type { ThreadMessage, TranscriptItem } from './types'

function toHistoryTurnId(threadId: string, messageId: string): string {
  return `history:${threadId}:${messageId}`
}

function toHistoryLogId(threadId: string, messageId: string): string {
  return `history-${threadId}-${messageId}`
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

function toCanonicalHistoryEvents(args: { threadId: string; messages: ThreadMessage[] }): CanonicalEvent[] {
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

export function mapThreadHistoryToCanonicalLogs(args: {
  threadId: string
  messages: ThreadMessage[]
}): TranscriptItem[] {
  const canonicalEvents = toCanonicalHistoryEvents(args)
  const projection = canonicalEvents.reduce(
    (state, event) => reduceTranscriptProjection(state, event),
    createInitialTranscriptProjectionState({ threadId: args.threadId }),
  )
  const segmentByTurnId = new Map<string, (typeof projection.segments)[number][]>()
  for (const segment of projection.segments) {
    const list = segmentByTurnId.get(segment.turnId) ?? []
    list.push(segment)
    segmentByTurnId.set(segment.turnId, list)
  }

  return args.messages.map((message): TranscriptItem => {
    const logId = toHistoryLogId(args.threadId, message.id)
    const turnId = toHistoryTurnId(args.threadId, message.id)
    if (message.kind === 'message') {
      if (message.role === 'user') {
        return {
          id: logId,
          kind: 'message',
          role: 'user',
          text: message.text,
        }
      }
      const assistantSegment = segmentByTurnId.get(turnId)?.find((segment) => segment.kind === 'assistant')
      return {
        id: logId,
        kind: 'message',
        role: 'assistant',
        text: assistantSegment && assistantSegment.kind === 'assistant' ? assistantSegment.text : message.text,
      }
    }

    const toolSegment = segmentByTurnId.get(turnId)?.find((segment) => segment.kind === 'tool')
    if (toolSegment && toolSegment.kind === 'tool') {
      if (message.status === 'running') {
        return {
          id: logId,
          kind: 'tool_call',
          toolUseId: toolSegment.toolUseId,
          toolName: toolSegment.toolName,
          status: 'running',
          summary: message.summary || toolSegment.summary,
          detailLines: message.detailLines ?? toolSegment.detailLines,
          ...(toolSegment.paramsText ? { paramsText: toolSegment.paramsText } : {}),
        }
      }
      return {
        id: logId,
        kind: 'tool_call',
        toolUseId: toolSegment.toolUseId,
        toolName: toolSegment.toolName,
        status: toolSegment.status,
        summary: toolSegment.summary,
        detailLines: toolSegment.detailLines,
        ...(toolSegment.paramsText ? { paramsText: toolSegment.paramsText } : {}),
      }
    }
    return {
      id: logId,
      kind: 'tool_call',
      toolUseId: message.toolUseId,
      toolName: message.toolName,
      status: message.status,
      summary: message.summary,
      detailLines: message.detailLines ?? [],
      ...(message.paramsText ? { paramsText: message.paramsText } : {}),
    }
  })
}
