import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  isCanonicalEventSchemaVersion,
  type CanonicalEvent,
  type CanonicalEventSource,
} from '../core/canonicalEvents'
import { isInputKind, isInputStatus } from '@formax/shared/inputContracts'
import { inferCanonicalFailureStatus, toCanonicalTimestamp } from './canonicalAdapterCommon'
import { toCanonicalEventsFromStreamPayload } from './streamEventCanonicalMapper'

export type TurnNotification = {
  method: string
  params?: Record<string, unknown>
}

export type TurnNotificationCanonicalContext = {
  fallbackThreadId: string
  nextReplaySeq?: () => number
  source?: CanonicalEventSource
  now?: () => string
  requireEnvelope?: boolean
  onInvalidEnvelope?: (issue: TurnNotificationEnvelopeIssue) => void
}

const TURN_NOTIFICATION_CANONICAL_METHODS = new Set([
  'turn/started',
  'turn/event',
  'turn/completed',
  'turn/failed',
  'turn/inputRequested',
  'turn/inputResolved',
])
const TURN_EVENT_STREAM_TYPES = new Set(['assistant_delta', 'thinking_delta', 'tool_start', 'tool_input', 'tool_update', 'tool_end'])

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
  if (method === 'turn/started') {
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

function resolveTurnStartedInputText(params: Record<string, unknown> | undefined): string | null {
  const input = params?.input
  if (!input || typeof input !== 'object') return null
  const text = (input as Record<string, unknown>).text
  if (typeof text !== 'string' || !text.trim()) return null
  return text
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

  if (notification.method === 'turn/started') {
    const replaySeq = resolveReplaySeq(params, ctx.nextReplaySeq)
    if (replaySeq == null) return []
    const text = resolveTurnStartedInputText(params)
    if (!text) return []
    return [
      {
        ...toEnvelope({ params, threadId, turnId, kind: 'user_message', replaySeq, source, now: ctx.now }),
        kind: 'user_message',
        turnId,
        text,
      },
    ]
  }

  if (notification.method === 'turn/event') {
    const replaySeq = resolveReplaySeq(params, ctx.nextReplaySeq)
    if (replaySeq == null) return []
    const event = params?.event
    if (!event || typeof event !== 'object') return []
    const streamEvent = event as Record<string, unknown>
    const streamType = typeof streamEvent.type === 'string' ? streamEvent.type : ''
    if (!TURN_EVENT_STREAM_TYPES.has(streamType)) return []
    let seq = replaySeq - 1
    return toCanonicalEventsFromStreamPayload(streamEvent, {
      turnId,
      nextReplaySeq: () => {
        seq += 1
        return seq
      },
      envelopeFor: ({ kind, replaySeq }) =>
        toEnvelope({ params, threadId, turnId, kind, replaySeq, source, now: ctx.now }),
      inferFailureStatus: inferCanonicalFailureStatus,
      resolveThinkingDeltaText: (inputEvent) => String(inputEvent.thinking ?? inputEvent.text ?? inputEvent.delta ?? ''),
      includeToolNameOnNonStart: true,
      includeToolProgressFieldsOnEnd: true,
      includeCompletedSummaryFallbackOnToolEnd: true,
    })
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
    if (!isInputKind(kind)) return []
    if (!isInputStatus(status)) return []
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
