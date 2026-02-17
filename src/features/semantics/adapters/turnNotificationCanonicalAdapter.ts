import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  isCanonicalEventSchemaVersion,
  type CanonicalEvent,
  type CanonicalEventSource,
} from '../core/canonicalEvents'
import { formatToolInputAsParamsText } from '../../tools/presentation/paramsText'
import { inferCanonicalFailureStatus, toCanonicalTimestamp } from './canonicalAdapterCommon'

type TurnNotification = {
  method: string
  params?: Record<string, unknown>
}

type TurnNotificationCanonicalContext = {
  fallbackThreadId: string
  nextReplaySeq?: () => number
  source?: CanonicalEventSource
  now?: () => string
  requireEnvelope?: boolean
  onInvalidEnvelope?: (issue: TurnNotificationEnvelopeIssue) => void
}

const TURN_NOTIFICATION_CANONICAL_METHODS = new Set([
  'turn/event',
  'turn/completed',
  'turn/failed',
  'turn/inputRequested',
  'turn/inputResolved',
])

type TurnNotificationEnvelopeField = 'threadId' | 'turnId' | 'replaySeq' | 'eventId' | 'ts' | 'source' | 'schemaVersion'

export type TurnNotificationEnvelopeIssue = {
  method: string
  missing: TurnNotificationEnvelopeField[]
  invalid?: TurnNotificationEnvelopeField[]
}

function resolveReplaySeq(
  params: Record<string, unknown> | undefined,
  nextReplaySeq?: () => number,
): number | null {
  const raw = params?.replaySeq
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw
  }
  if (nextReplaySeq) return nextReplaySeq()
  return null
}

function resolveReplaySeqPair(
  params: Record<string, unknown> | undefined,
  nextReplaySeq?: () => number,
): { first: number; second: number } | null {
  const raw = params?.replaySeq
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return { first: raw, second: raw + 1 }
  }
  if (nextReplaySeq) {
    const first = nextReplaySeq()
    const second = nextReplaySeq()
    return { first, second: second > first ? second : first + 1 }
  }
  return null
}

function resolveThreadId(
  params: Record<string, unknown> | undefined,
  fallbackThreadId: string,
): string {
  if (typeof params?.threadId === 'string' && params.threadId.trim()) return params.threadId
  const turn = params?.turn
  if (turn && typeof turn === 'object') {
    const threadId = (turn as Record<string, unknown>).threadId
    if (typeof threadId === 'string' && threadId.trim()) return threadId
  }
  const input = params?.input
  if (input && typeof input === 'object') {
    const threadId = (input as Record<string, unknown>).threadId
    if (typeof threadId === 'string' && threadId.trim()) return threadId
  }
  return fallbackThreadId
}

function resolveTurnId(params: Record<string, unknown> | undefined): string | null {
  if (typeof params?.turnId === 'string' && params.turnId.trim()) return params.turnId
  const turn = params?.turn
  if (turn && typeof turn === 'object') {
    const turnId = (turn as Record<string, unknown>).id
    if (typeof turnId === 'string' && turnId.trim()) return turnId
  }
  const input = params?.input
  if (input && typeof input === 'object') {
    const turnId = (input as Record<string, unknown>).turnId
    if (typeof turnId === 'string' && turnId.trim()) return turnId
  }
  return null
}

function resolveThreadIdFromEnvelope(params: Record<string, unknown> | undefined): string | null {
  if (typeof params?.threadId === 'string' && params.threadId.trim()) return params.threadId
  const turn = params?.turn
  if (turn && typeof turn === 'object') {
    const threadId = (turn as Record<string, unknown>).threadId
    if (typeof threadId === 'string' && threadId.trim()) return threadId
  }
  const input = params?.input
  if (input && typeof input === 'object') {
    const threadId = (input as Record<string, unknown>).threadId
    if (typeof threadId === 'string' && threadId.trim()) return threadId
  }
  return null
}

function resolveTurnIdFromEnvelope(
  method: string,
  params: Record<string, unknown> | undefined,
): string | null {
  if (method === 'turn/completed' || method === 'turn/failed') {
    const turn = params?.turn
    if (turn && typeof turn === 'object') {
      const turnId = (turn as Record<string, unknown>).id
      if (typeof turnId === 'string' && turnId.trim()) return turnId
    }
    return null
  }
  if (typeof params?.turnId === 'string' && params.turnId.trim()) return params.turnId
  return null
}

function toEventId(args: {
  params: Record<string, unknown> | undefined
  threadId: string
  turnId: string
  kind: CanonicalEvent['kind']
  replaySeq: number
}): string {
  const raw = typeof args.params?.eventId === 'string' ? args.params.eventId.trim() : ''
  if (raw) return `${raw}:${args.kind}:${args.replaySeq}`
  return `${args.threadId}:${args.turnId}:${args.kind}:${args.replaySeq}`
}

function toEnvelope(args: {
  params: Record<string, unknown> | undefined
  threadId: string
  turnId: string
  kind: CanonicalEvent['kind']
  replaySeq: number
  source: CanonicalEventSource
  now?: () => string
}): Pick<CanonicalEvent, 'schemaVersion' | 'threadId' | 'replaySeq' | 'eventId' | 'ts' | 'source'> {
  const schemaVersion = isCanonicalEventSchemaVersion(args.params?.schemaVersion)
    ? args.params?.schemaVersion
    : CANONICAL_EVENT_SCHEMA_VERSION
  return {
    schemaVersion,
    threadId: args.threadId,
    replaySeq: args.replaySeq,
    eventId: toEventId({
      params: args.params,
      threadId: args.threadId,
      turnId: args.turnId,
      kind: args.kind,
      replaySeq: args.replaySeq,
    }),
    ts:
      typeof args.params?.ts === 'string' && args.params.ts.trim()
        ? args.params.ts
        : toCanonicalTimestamp(args.now),
    source: args.source,
  }
}

function isCanonicalSource(value: unknown): value is CanonicalEventSource {
  return value === 'engine' || value === 'tool' || value === 'policy' || value === 'system' || value === 'ui'
}

function resolveSource(
  params: Record<string, unknown> | undefined,
  contextSource: CanonicalEventSource | undefined,
): CanonicalEventSource {
  if (isCanonicalSource(params?.source)) return params.source
  if (contextSource) return contextSource
  return 'engine'
}

function validateTurnNotificationEnvelope(notification: TurnNotification): TurnNotificationEnvelopeIssue | null {
  if (!TURN_NOTIFICATION_CANONICAL_METHODS.has(notification.method)) return null
  const params = notification.params
  const missing: TurnNotificationEnvelopeField[] = []
  const invalid: TurnNotificationEnvelopeField[] = []
  if (!resolveThreadIdFromEnvelope(params)) missing.push('threadId')
  if (!resolveTurnIdFromEnvelope(notification.method, params)) missing.push('turnId')
  const replaySeq = params?.replaySeq
  if (!(typeof replaySeq === 'number' && Number.isFinite(replaySeq) && replaySeq > 0)) {
    missing.push('replaySeq')
  }
  const eventId = typeof params?.eventId === 'string' ? params.eventId.trim() : ''
  if (!eventId) missing.push('eventId')
  const ts = typeof params?.ts === 'string' ? params.ts.trim() : ''
  if (!ts) missing.push('ts')
  if (!isCanonicalSource(params?.source)) missing.push('source')
  if (params?.schemaVersion != null && !isCanonicalEventSchemaVersion(params.schemaVersion)) {
    invalid.push('schemaVersion')
  }
  if (missing.length === 0 && invalid.length === 0) return null
  return invalid.length > 0
    ? {
        method: notification.method,
        missing,
        invalid,
      }
    : {
        method: notification.method,
        missing,
      }
}

function resolveFailureFooterStatus(
  params: Record<string, unknown> | undefined,
  message: string,
): 'failed' | 'interrupted' {
  const turn = params?.turn
  if (turn && typeof turn === 'object') {
    const status = (turn as Record<string, unknown>).status
    if (status === 'interrupted' || status === 'failed') return status
  }
  return inferCanonicalFailureStatus(message)
}

function readToolUpdateLine(event: Record<string, unknown>): string | undefined {
  const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
  if (transcriptLines.length > 0) {
    const line = String(transcriptLines[transcriptLines.length - 1] ?? '').trim()
    if (line) return line
  }
  const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
  if (middleLines.length > 0) {
    const line = String(middleLines[middleLines.length - 1] ?? '').trim()
    if (line) return line
  }
  if (typeof event.toolUses === 'number' && Number.isFinite(event.toolUses)) {
    return `tool uses ${event.toolUses}`
  }
  return undefined
}

function readToolEndSummary(event: Record<string, unknown>): string | undefined {
  const result = event.result
  if (!result || typeof result !== 'object') return undefined
  const content = String((result as Record<string, unknown>).content ?? '').trim()
  if (content) return content
  const isError = Boolean((result as Record<string, unknown>).is_error)
  return isError ? 'error' : 'completed'
}

export function toCanonicalEventsFromTurnNotification(
  notification: TurnNotification,
  ctx: TurnNotificationCanonicalContext,
): CanonicalEvent[] {
  if (ctx.requireEnvelope) {
    const envelopeIssue = validateTurnNotificationEnvelope(notification)
    if (envelopeIssue) {
      ctx.onInvalidEnvelope?.(envelopeIssue)
      return []
    }
  }
  const params = notification.params
  const turnId = resolveTurnId(params)
  if (!turnId) return []
  const threadId = resolveThreadId(params, ctx.fallbackThreadId)
  const source = resolveSource(params, ctx.source)

  if (notification.method === 'turn/event') {
    const replaySeq = resolveReplaySeq(params, ctx.nextReplaySeq)
    if (replaySeq == null) return []
    const event = params?.event
    if (!event || typeof event !== 'object') return []
    const streamEvent = event as Record<string, unknown>
    const eventType = streamEvent.type

    if (eventType === 'assistant_delta') {
      const textDelta = String(streamEvent.text ?? '')
      if (!textDelta) return []
      return [
        {
          ...toEnvelope({ params, threadId, turnId, kind: 'assistant_delta', replaySeq, source, now: ctx.now }),
          kind: 'assistant_delta',
          turnId,
          textDelta,
        },
      ]
    }

    if (eventType === 'thinking_delta') {
      const textDelta = String(streamEvent.thinking ?? streamEvent.text ?? streamEvent.delta ?? '')
      if (!textDelta) return []
      return [
        {
          ...toEnvelope({ params, threadId, turnId, kind: 'thinking_delta', replaySeq, source, now: ctx.now }),
          kind: 'thinking_delta',
          turnId,
          textDelta,
        },
      ]
    }

    if (eventType === 'tool_start' || eventType === 'tool_update' || eventType === 'tool_end' || eventType === 'tool_input') {
      const toolUseIdRaw = streamEvent.id ?? streamEvent.toolUseId
      const toolUseId = typeof toolUseIdRaw === 'string' ? toolUseIdRaw.trim() : ''
      if (!toolUseId) return []

      const toolNameRaw = streamEvent.name
      const toolName = typeof toolNameRaw === 'string' && toolNameRaw.trim() ? toolNameRaw : undefined
      const phase =
        eventType === 'tool_start' ? 'start' : eventType === 'tool_end' ? 'end' : 'update'
      const line = eventType === 'tool_update' ? readToolUpdateLine(streamEvent) : undefined
      const summary = eventType === 'tool_end' ? readToolEndSummary(streamEvent) : undefined
      const paramsText = formatToolInputAsParamsText(streamEvent.input)
      const input =
        streamEvent.input && typeof streamEvent.input === 'object' && !Array.isArray(streamEvent.input)
          ? (streamEvent.input as Record<string, unknown>)
          : undefined
      const isError =
        eventType === 'tool_end' &&
        Boolean((streamEvent.result as Record<string, unknown> | undefined)?.is_error)
      const result =
        eventType === 'tool_end'
          ? String(((streamEvent.result as Record<string, unknown> | undefined)?.content ?? ''))
          : ''
      const middleLines = Array.isArray(streamEvent.middleLines) ? streamEvent.middleLines.map((l) => String(l)) : null
      const transcriptLines = Array.isArray(streamEvent.transcriptLines)
        ? streamEvent.transcriptLines.map((l) => String(l))
        : null
      const nestedTools = Array.isArray(streamEvent.nestedTools)
        ? (streamEvent.nestedTools as Array<Record<string, unknown>>)
            .map((item) => {
              const id = typeof item.id === 'string' ? item.id : ''
              const name = typeof item.name === 'string' ? item.name : ''
              const status = item.status
              if (!id || !name || (status !== 'running' && status !== 'completed' && status !== 'error')) return null
              const nestedStatus = status as 'running' | 'completed' | 'error'
              const inputValue =
                item.input && typeof item.input === 'object' && !Array.isArray(item.input)
                  ? (item.input as Record<string, unknown>)
                  : {}
              const summary = typeof item.summary === 'string' ? item.summary : undefined
              return { id, name, input: inputValue, status: nestedStatus, ...(summary ? { summary } : {}) }
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : null
      const toolUses = typeof streamEvent.toolUses === 'number' ? streamEvent.toolUses : undefined
      const usage =
        streamEvent.usage && typeof streamEvent.usage === 'object' && !Array.isArray(streamEvent.usage)
          ? (streamEvent.usage as any)
          : undefined

      return [
        {
          ...toEnvelope({ params, threadId, turnId, kind: 'tool_event', replaySeq, source, now: ctx.now }),
          kind: 'tool_event',
          turnId,
          toolUseId,
          phase,
          ...(toolName ? { toolName } : {}),
          ...(input ? { input } : {}),
          ...(paramsText ? { paramsText } : {}),
          ...(line ? { line } : {}),
          ...(summary ? { summary } : {}),
          ...(result ? { result } : {}),
          ...(middleLines ? { middleLines } : {}),
          ...(transcriptLines ? { transcriptLines } : {}),
          ...(nestedTools ? { nestedTools } : {}),
          ...(typeof toolUses === 'number' ? { toolUses } : {}),
          ...(usage ? { usage } : {}),
          ...(isError ? { isError } : {}),
        },
      ]
    }

    return []
  }

  if (notification.method === 'turn/completed') {
    const pair = resolveReplaySeqPair(params, ctx.nextReplaySeq)
    if (!pair) return []
    return [
      {
        ...toEnvelope({
          params,
          threadId,
          turnId,
          kind: 'thinking_finalized',
          replaySeq: pair.first,
          source,
          now: ctx.now,
        }),
        kind: 'thinking_finalized',
        turnId,
      },
      {
        ...toEnvelope({
          params,
          threadId,
          turnId,
          kind: 'turn_footer',
          replaySeq: pair.second,
          source,
          now: ctx.now,
        }),
        kind: 'turn_footer',
        turnId,
        status: 'completed',
      },
    ]
  }

  if (notification.method === 'turn/failed') {
    const message = String(params?.error ?? 'unknown')
    const pair = resolveReplaySeqPair(params, ctx.nextReplaySeq)
    if (!pair) return []
    const status = resolveFailureFooterStatus(params, message)
    return [
      {
        ...toEnvelope({
          params,
          threadId,
          turnId,
          kind: 'thinking_finalized',
          replaySeq: pair.first,
          source,
          now: ctx.now,
        }),
        kind: 'thinking_finalized',
        turnId,
      },
      {
        ...toEnvelope({
          params,
          threadId,
          turnId,
          kind: 'turn_footer',
          replaySeq: pair.second,
          source,
          now: ctx.now,
        }),
        kind: 'turn_footer',
        turnId,
        status,
        message,
      },
    ]
  }

  if (notification.method === 'turn/inputRequested' || notification.method === 'turn/inputResolved') {
    const replaySeq = resolveReplaySeq(params, ctx.nextReplaySeq)
    if (replaySeq == null) return []
    const input = params?.input
    if (!input || typeof input !== 'object') return []
    const inputRecord = input as Record<string, unknown>
    const toolUseId = typeof inputRecord.toolUseId === 'string' ? inputRecord.toolUseId.trim() : ''
    const kind = inputRecord.kind
    const status = inputRecord.status
    if (!toolUseId) return []
    if (kind !== 'approval' && kind !== 'ask_user_question') return []
    if (
      status !== 'pending' &&
      status !== 'submitted' &&
      status !== 'canceled' &&
      status !== 'expired' &&
      status !== 'failed'
    ) {
      return []
    }
    const toolNameRaw = (inputRecord.payload as Record<string, unknown> | undefined)?.toolName
    const toolName = typeof toolNameRaw === 'string' && toolNameRaw.trim() ? toolNameRaw : undefined
    return [
      {
        ...toEnvelope({ params, threadId, turnId, kind: 'tool_input_state', replaySeq, source, now: ctx.now }),
        kind: 'tool_input_state',
        turnId,
        toolUseId,
        inputKind: kind,
        status,
        ...(toolName ? { toolName } : {}),
      },
    ]
  }

  return []
}
