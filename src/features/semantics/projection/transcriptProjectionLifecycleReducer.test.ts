import { describe, expect, it } from 'vitest'
import {
  closeAssistantSegment,
  closeThinkingSegment,
  closeTurnTextSegments,
  type TranscriptLifecycleDraft,
} from './transcriptProjectionLifecycleReducer'
import type { TranscriptSegment } from './transcriptProjectionTypes'

function makeDraft(): TranscriptLifecycleDraft {
  const segments: TranscriptSegment[] = [
    {
      id: 'thinking-1',
      kind: 'thinking',
      turnId: 'turn-1',
      text: 'reasoning',
      status: 'running',
    },
    {
      id: 'assistant-1',
      kind: 'assistant',
      turnId: 'turn-1',
      text: 'hello',
    },
  ]
  return {
    segments,
    openAssistantSegmentIdByTurn: { 'turn-1': 'assistant-1' },
    openThinkingSegmentIdByTurn: { 'turn-1': 'thinking-1' },
  }
}

describe('transcriptProjectionLifecycleReducer', () => {
  it('closes assistant open segment id for a turn', () => {
    const draft = makeDraft()
    closeAssistantSegment(draft, 'turn-1')
    expect(draft.openAssistantSegmentIdByTurn['turn-1']).toBeUndefined()
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBe('thinking-1')
  })

  it('finalizes thinking segment and clears open id', () => {
    const draft = makeDraft()
    closeThinkingSegment(draft, 'turn-1')
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBeUndefined()
    expect(draft.segments[0]).toMatchObject({
      kind: 'thinking',
      status: 'finalized',
    })
  })

  it('closes both assistant and thinking segments for turn', () => {
    const draft = makeDraft()
    closeTurnTextSegments(draft, 'turn-1')
    expect(draft.openAssistantSegmentIdByTurn['turn-1']).toBeUndefined()
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBeUndefined()
  })

  it('is a no-op when turn has no open assistant/thinking segments', () => {
    const draft = makeDraft()
    closeAssistantSegment(draft, 'turn-x')
    closeThinkingSegment(draft, 'turn-x')
    expect(draft.openAssistantSegmentIdByTurn['turn-1']).toBe('assistant-1')
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBe('thinking-1')
  })

  it('clears dangling open thinking id even when segment is missing', () => {
    const draft = makeDraft()
    draft.openThinkingSegmentIdByTurn['turn-1'] = 'missing-id'
    closeThinkingSegment(draft, 'turn-1')
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBeUndefined()
  })

  it('does not force-finalize non-running thinking segments', () => {
    const draft = makeDraft()
    draft.segments[0] = {
      id: 'thinking-1',
      kind: 'thinking',
      turnId: 'turn-1',
      text: 'reasoning',
      status: 'finalized',
    }
    closeThinkingSegment(draft, 'turn-1')
    expect(draft.segments[0]).toMatchObject({
      kind: 'thinking',
      status: 'finalized',
    })
  })
})
