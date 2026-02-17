import { useCallback, useRef } from 'react'
import { isCanonicalEventSource, type CanonicalEventSource } from '../../../../../src/features/semantics/core/canonicalEvents'

export function useCanonicalMeta(args: {
  activeThreadIdRef: { current: string | null }
  nowIso: () => string
}) {
  const { activeThreadIdRef, nowIso } = args
  const canonicalReplaySeqRef = useRef(0)

  const nextCanonicalReplaySeq = useCallback((candidate?: unknown): number => {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      const replaySeq = candidate > canonicalReplaySeqRef.current ? candidate : canonicalReplaySeqRef.current + 1
      canonicalReplaySeqRef.current = replaySeq
      return replaySeq
    }
    canonicalReplaySeqRef.current += 1
    return canonicalReplaySeqRef.current
  }, [])

  const toCanonicalMeta = useCallback(
    (args: {
      threadId: string | null | undefined
      turnId: string
      kind: string
      params?: Record<string, unknown> | null | undefined
    }): {
      threadId: string
      replaySeq: number
      eventId: string
      ts: string
      source: CanonicalEventSource
    } => {
      const resolvedThreadId = args.threadId ?? activeThreadIdRef.current ?? '__active_thread__'
      const params = args.params
      const replaySeq = nextCanonicalReplaySeq(params?.replaySeq)
      const eventIdRaw = typeof params?.eventId === 'string' ? params.eventId.trim() : ''
      const eventId = eventIdRaw || `${resolvedThreadId}:${args.turnId}:${args.kind}:${replaySeq}`
      const ts = typeof params?.ts === 'string' && params.ts.trim() ? params.ts : nowIso()
      const sourceRaw = params?.source
      const source = isCanonicalEventSource(sourceRaw) ? sourceRaw : 'engine'
      return {
        threadId: resolvedThreadId,
        replaySeq,
        eventId,
        ts,
        source,
      }
    },
    [activeThreadIdRef, nextCanonicalReplaySeq, nowIso],
  )

  return {
    toCanonicalMeta,
  }
}
