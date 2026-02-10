export type TurnEventCursorState = {
  seenEventCap: number
  lastSeqByTrace: Map<string, number>
  seenEventIds: Set<string>
  seenEventOrder: string[]
}

export function createTurnEventCursorState(seenEventCap = 2000): TurnEventCursorState {
  return {
    seenEventCap,
    lastSeqByTrace: new Map<string, number>(),
    seenEventIds: new Set<string>(),
    seenEventOrder: [],
  }
}

function markEventSeen(state: TurnEventCursorState, eventId: string): boolean {
  if (state.seenEventIds.has(eventId)) return false
  state.seenEventIds.add(eventId)
  state.seenEventOrder.push(eventId)
  if (state.seenEventOrder.length > state.seenEventCap) {
    const overflow = state.seenEventOrder.length - state.seenEventCap
    const dropped = state.seenEventOrder.splice(0, overflow)
    for (const id of dropped) {
      state.seenEventIds.delete(id)
    }
  }
  return true
}

export function shouldAcceptSequencedNotification(state: TurnEventCursorState, params: any): boolean {
  const eventId = typeof params?.eventId === 'string' ? params.eventId : null
  if (eventId && !markEventSeen(state, eventId)) return false

  const traceId = typeof params?.traceId === 'string' ? params.traceId : null
  const seq = typeof params?.seq === 'number' && Number.isFinite(params.seq) ? params.seq : null
  if (!traceId || seq == null) return true

  const lastSeq = state.lastSeqByTrace.get(traceId)
  if (typeof lastSeq === 'number' && seq <= lastSeq) return false
  state.lastSeqByTrace.set(traceId, seq)
  return true
}
