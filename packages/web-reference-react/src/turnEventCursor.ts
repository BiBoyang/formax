export type TurnEventCursorState = {
  seenEventCap: number
  lastLiveReplaySeq: number | null
  lastReplaySeqByReplayScope: Map<string, number>
  lastSeqByTrace: Map<string, number>
  seenEventIds: Set<string>
  seenEventOrder: string[]
}

export type SequencedNotificationOwner =
  | { kind: 'live-stream' }
  | { kind: 'thread-replay'; threadId: string }

export function createTurnEventCursorState(seenEventCap = 2000): TurnEventCursorState {
  return {
    seenEventCap,
    lastLiveReplaySeq: null,
    lastReplaySeqByReplayScope: new Map<string, number>(),
    lastSeqByTrace: new Map<string, number>(),
    seenEventIds: new Set<string>(),
    seenEventOrder: [],
  }
}

export function resetSequencedNotificationOwner(
  state: TurnEventCursorState,
  owner: SequencedNotificationOwner,
): void {
  if (owner.kind === 'live-stream') {
    state.lastLiveReplaySeq = null
    state.lastSeqByTrace.clear()
    return
  }
  const threadId = owner.threadId.trim()
  if (!threadId) return
  state.lastReplaySeqByReplayScope.delete(`thread:${threadId}`)
}

function rememberEventSeen(state: TurnEventCursorState, eventId: string): void {
  state.seenEventIds.add(eventId)
  state.seenEventOrder.push(eventId)
  if (state.seenEventOrder.length > state.seenEventCap) {
    const overflow = state.seenEventOrder.length - state.seenEventCap
    const dropped = state.seenEventOrder.splice(0, overflow)
    for (const id of dropped) {
      state.seenEventIds.delete(id)
    }
  }
}

export function shouldAcceptSequencedNotification(
  state: TurnEventCursorState,
  params: any,
  owner: SequencedNotificationOwner,
): boolean {
  const replaySeq = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null

  if (owner.kind === 'thread-replay') {
    const threadId = owner.threadId.trim()
    if (!threadId) return false
    if (replaySeq == null) return true
    const replayScope = `thread:${threadId}`
    const lastReplaySeq = state.lastReplaySeqByReplayScope.get(replayScope)
    if (typeof lastReplaySeq === 'number' && replaySeq <= lastReplaySeq) return false
    state.lastReplaySeqByReplayScope.set(replayScope, replaySeq)
    return true
  }

  const eventId = typeof params?.eventId === 'string' ? params.eventId : null
  if (eventId && state.seenEventIds.has(eventId)) return false

  if (replaySeq != null) {
    if (typeof state.lastLiveReplaySeq === 'number' && replaySeq <= state.lastLiveReplaySeq) return false
    if (eventId) rememberEventSeen(state, eventId)
    state.lastLiveReplaySeq = replaySeq
    return true
  }

  const traceId = typeof params?.traceId === 'string' ? params.traceId : null
  const seq = typeof params?.seq === 'number' && Number.isFinite(params.seq) ? params.seq : null
  if (!traceId || seq == null) {
    if (eventId) rememberEventSeen(state, eventId)
    return true
  }

  const lastSeq = state.lastSeqByTrace.get(traceId)
  if (typeof lastSeq === 'number' && seq <= lastSeq) return false
  if (eventId) rememberEventSeen(state, eventId)
  state.lastSeqByTrace.set(traceId, seq)
  return true
}
