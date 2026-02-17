import type { StreamEvent } from '../../../../streaming/types'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import { toCanonicalEventsFromStreamEvent } from '../../../semantics/adapters/streamCanonicalAdapter'
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

function resolveCanonicalSourceFromStreamEvent(event: StreamEvent): CanonicalEvent['source'] {
  if (event.type === 'approval_request') return 'policy'
  if (event.type === 'ask_user_question') return 'tool'
  if (event.type.startsWith('tool_')) return 'tool'
  if (event.type === 'error') return 'system'
  return 'engine'
}

export function resolveCanonicalStreamWritePolicy(args: {
  canonical?: CanonicalStreamBridge
  event: StreamEvent
}): CanonicalStreamWritePolicy {
  const canonicalTurnId = args.canonical?.getTurnId() ?? null
  const shouldForwardCanonical = !(args.event.type === 'error' && isAbortLikeError(args.event.error))
  const canonicalBridgeActive = Boolean(args.canonical && canonicalTurnId)
  const canonicalOnly = canonicalBridgeActive
  return {
    canonicalTurnId,
    canonicalBridgeActive,
    canonicalOnly,
    canWriteLegacyTranscript: !canonicalOnly,
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
  const canonicalEvents = toCanonicalEventsFromStreamEvent(args.event, {
    threadId: args.canonical.threadId,
    turnId: args.canonicalTurnId,
    nextReplaySeq: args.canonical.nextReplaySeq,
    source: resolveCanonicalSourceFromStreamEvent(args.event),
  })
  for (const event of canonicalEvents) {
    args.canonical.onEvent(args.mapEvent ? args.mapEvent(event) : event)
  }
}
