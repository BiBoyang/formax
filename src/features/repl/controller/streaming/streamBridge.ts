import type { StreamEvent } from '../../../../streaming/types'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import { mapStreamEventToCanonicalEvents } from '../../../semantics/adapters/canonicalEventAdapter'
import { sourceFromRuntimeEventType } from '../../../../shared/runtimeEventSource'
import { isAbortLikeError } from '../shared/utils'

export type CanonicalStreamBridge = {
  threadId: string
  getTurnId: () => string | null
  nextReplaySeq: () => number
  onEvent: (event: CanonicalEvent) => void
}

export type CanonicalStreamWritePolicy = {
  canonicalTurnId: string | null
  canonicalBridgeActive: boolean
  canonicalOnly: boolean
  canWriteLegacyTranscript: boolean
  shouldForwardCanonical: boolean
}

export function resolveCanonicalStreamWritePolicy(args: {
  canonical?: CanonicalStreamBridge
  event: StreamEvent
}): CanonicalStreamWritePolicy {
  const canonicalTurnId = args.canonical?.getTurnId() ?? null
  const canonicalBridgeConfigured = Boolean(args.canonical)
  const canonicalBridgeActive = Boolean(args.canonical && canonicalTurnId)
  const canonicalOnly = canonicalBridgeConfigured
  const shouldForwardCanonical =
    canonicalBridgeActive && !(args.event.type === 'error' && isAbortLikeError(args.event.error))
  return {
    canonicalTurnId,
    canonicalBridgeActive,
    canonicalOnly,
    canWriteLegacyTranscript: !canonicalBridgeConfigured,
    shouldForwardCanonical,
  }
}

export function forwardCanonicalStreamEvent(args: {
  canonical?: CanonicalStreamBridge
  canonicalTurnId: string | null
  event: StreamEvent
  mapEvent?: (event: CanonicalEvent) => CanonicalEvent
}): void {
  if (!args.canonical || !args.canonicalTurnId) return
  const canonicalEvents = mapStreamEventToCanonicalEvents(args.event, {
    threadId: args.canonical.threadId,
    turnId: args.canonicalTurnId,
    nextReplaySeq: args.canonical.nextReplaySeq,
    source: sourceFromRuntimeEventType(args.event.type),
  })
  for (const event of canonicalEvents) {
    args.canonical.onEvent(args.mapEvent ? args.mapEvent(event) : event)
  }
}
