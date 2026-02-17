import { describe, expect, it } from 'vitest'
import type { CanonicalEvent } from '../core/canonicalEvents'
import { createInitialTranscriptProjectionState } from './transcriptProjection'
import { finalizeProjectionReduction, prepareProjectionReduction } from './transcriptProjectionCore'

function makeEvent(args: { eventId: string; replaySeq: number; threadId?: string }): CanonicalEvent {
  return {
    kind: 'assistant_delta',
    threadId: args.threadId ?? 'thread-1',
    eventId: args.eventId,
    replaySeq: args.replaySeq,
    ts: '2026-02-13T01:10:00.000Z',
    source: 'engine',
    turnId: 'turn-1',
    textDelta: 'hello',
  }
}

describe('transcriptProjectionCore', () => {
  it('skips events from other threads', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const prepared = prepareProjectionReduction({
      state,
      event: makeEvent({ eventId: 'e1', replaySeq: 1, threadId: 'thread-2' }),
    })
    expect(prepared.kind).toBe('skip')
    if (prepared.kind === 'skip') {
      expect(prepared.state).toBe(state)
    }
  })

  it('skips stale replay event but records seenEventIds', () => {
    const state = {
      ...createInitialTranscriptProjectionState({ threadId: 'thread-1' }),
      lastReplaySeq: 3,
    }
    const prepared = prepareProjectionReduction({
      state,
      event: makeEvent({ eventId: 'stale-1', replaySeq: 2 }),
    })
    expect(prepared.kind).toBe('skip')
    if (prepared.kind === 'skip') {
      expect(prepared.state.seenEventIds.has('stale-1')).toBe(true)
      expect(prepared.state.lastReplaySeq).toBe(3)
    }
  })

  it('skips duplicate event id without creating a new state object', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    state.seenEventIds.add('dup-1')
    const prepared = prepareProjectionReduction({
      state,
      event: makeEvent({ eventId: 'dup-1', replaySeq: 10 }),
    })
    expect(prepared.kind).toBe('skip')
    if (prepared.kind === 'skip') {
      expect(prepared.state).toBe(state)
      expect(prepared.state.seenEventIds.size).toBe(1)
    }
  })

  it('proceeds for fresh events and finalizes state updates', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const event = makeEvent({ eventId: 'e2', replaySeq: 2 })
    const prepared = prepareProjectionReduction({ state, event })
    expect(prepared.kind).toBe('proceed')
    if (prepared.kind !== 'proceed') return

    prepared.draft.segments.push({
      id: 'assistant-1',
      kind: 'assistant',
      turnId: 'turn-1',
      text: 'hello',
    })
    const next = finalizeProjectionReduction({
      state,
      event,
      seenEventIds: prepared.seenEventIds,
      draft: prepared.draft,
    })
    expect(next.lastReplaySeq).toBe(2)
    expect(next.seenEventIds.has('e2')).toBe(true)
    expect(next.segments).toHaveLength(1)
    expect(next.segments[0]).toMatchObject({ kind: 'assistant', text: 'hello' })
  })
})
