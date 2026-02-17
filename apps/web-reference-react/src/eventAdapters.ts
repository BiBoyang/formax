import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../../../src/features/semantics/projection/transcriptProjection'
import { toCanonicalEventsFromHistoryMessages } from '../../../src/features/semantics/adapters/historyCanonicalAdapter'
import type { ThreadMessage, TranscriptItem } from './types'

function toHistoryTurnId(threadId: string, messageId: string): string {
  return `history:${threadId}:${messageId}`
}

function toHistoryLogId(threadId: string, messageId: string): string {
  return `history-${threadId}-${messageId}`
}

export function mapThreadHistoryToCanonicalLogs(args: {
  threadId: string
  messages: ThreadMessage[]
}): TranscriptItem[] {
  const canonicalEvents = toCanonicalEventsFromHistoryMessages(args)
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
