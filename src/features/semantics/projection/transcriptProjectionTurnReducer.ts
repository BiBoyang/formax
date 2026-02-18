import type { CanonicalTurnFooterEvent } from '../core/canonicalEvents'
import type { TranscriptSegmentIdFactory } from './transcriptProjectionIds'
import type { TranscriptSegment, TurnFooterSegment } from './transcriptProjectionTypes'

function finalizeRunningToolSegmentsForTurn(args: {
  draft: { segments: TranscriptSegment[] }
  event: CanonicalTurnFooterEvent
}): void {
  const completed = args.event.status === 'completed'
  const nextToolStatus: 'completed' | 'error' = completed ? 'completed' : 'error'
  const nextSummarySuffix = completed
    ? 'completed'
    : args.event.status === 'failed'
      ? 'failed'
      : 'interrupted'

  for (let index = 0; index < args.draft.segments.length; index += 1) {
    const segment = args.draft.segments[index]
    if (!segment || segment.kind !== 'tool') continue
    if (segment.turnId !== args.event.turnId) continue
    if (!(segment.status === 'running' || segment.terminalSource === 'turn_footer')) {
      args.draft.segments[index] = { ...segment, terminalSource: 'turn_footer' }
      continue
    }

    const autoSummaryCandidates = new Set([
      `${segment.toolName} running`,
      `${segment.toolName} completed`,
      `${segment.toolName} failed`,
      `${segment.toolName} interrupted`,
    ])
    const summary = autoSummaryCandidates.has(segment.summary)
      ? `${segment.toolName} ${nextSummarySuffix}`
      : segment.summary
    const shouldSetAbortResult = args.event.status === 'interrupted' && Boolean(args.event.message)
    const result = shouldSetAbortResult ? `Error: ${String(args.event.message ?? '')}` : segment.result
    args.draft.segments[index] = {
      ...segment,
      status: nextToolStatus,
      terminalSource: 'turn_footer',
      summary,
      ...(result !== undefined ? { result } : {}),
    }
  }
}

export function reduceTurnFooterEvent(args: {
  draft: {
    segments: TranscriptSegment[]
  }
  event: CanonicalTurnFooterEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
  finalizeRunningToolSegmentsForTurn({ draft, event })

  const existingIndex = draft.segments.findIndex(
    (segment) => segment.kind === 'turn_footer' && segment.turnId === event.turnId,
  )

  if (existingIndex >= 0) {
    const current = draft.segments[existingIndex]
    if (current.kind === 'turn_footer') {
      draft.segments[existingIndex] = {
        ...current,
        status: event.status,
        ...(event.message ? { message: event.message } : {}),
      }
    }
    return
  }

  const next: TurnFooterSegment = {
    id: args.toSegmentId({ kind: 'turn_footer', replaySeq: event.replaySeq, turnId: event.turnId }),
    kind: 'turn_footer',
    turnId: event.turnId,
    status: event.status,
    ...(event.message ? { message: event.message } : {}),
  }
  draft.segments.push(next)
}
