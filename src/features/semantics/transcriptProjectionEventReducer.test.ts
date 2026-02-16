import { describe, expect, it } from 'vitest'
import type { CanonicalEvent } from './canonicalEvents'
import { applyNonMessageProjectionEvent } from './transcriptProjectionEventReducer'
import { createTranscriptSegmentId } from './transcriptProjectionIds'
import type { ProjectionDraft } from './transcriptProjectionCore'

function makeDraft(): ProjectionDraft {
  return {
    segments: [],
    toolNameByUseId: {},
    openAssistantSegmentIdByTurn: {},
    openThinkingSegmentIdByTurn: {},
  }
}

function makeEvent(patch: Partial<CanonicalEvent> & { kind: CanonicalEvent['kind'] }): CanonicalEvent {
  return {
    threadId: 'thread-1',
    eventId: 'event-1',
    replaySeq: 1,
    ts: '2026-02-13T01:10:00.000Z',
    source: 'engine',
    ...patch,
  } as CanonicalEvent
}

describe('transcriptProjectionEventReducer', () => {
  it('applies assistant delta and opens assistant segment id', () => {
    const draft = makeDraft()
    applyNonMessageProjectionEvent({
      draft,
      event: makeEvent({
        kind: 'assistant_delta',
        turnId: 'turn-1',
        textDelta: 'hello',
      }),
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'assistant',
      turnId: 'turn-1',
      text: 'hello',
    })
    expect(draft.openAssistantSegmentIdByTurn['turn-1']).toBe('turn-1:assistant:1')
  })

  it('finalizes running thinking segment on thinking_finalized', () => {
    const draft: ProjectionDraft = {
      segments: [
        {
          id: 'turn-1:thinking:1',
          kind: 'thinking',
          turnId: 'turn-1',
          text: 'reasoning',
          status: 'running',
        },
      ],
      toolNameByUseId: {},
      openAssistantSegmentIdByTurn: {},
      openThinkingSegmentIdByTurn: { 'turn-1': 'turn-1:thinking:1' },
    }

    applyNonMessageProjectionEvent({
      draft,
      event: makeEvent({
        kind: 'thinking_finalized',
        turnId: 'turn-1',
      }),
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'thinking',
      status: 'finalized',
    })
    expect(draft.openThinkingSegmentIdByTurn['turn-1']).toBeUndefined()
  })

  it('creates tool segment for tool_input_state when no existing tool segment', () => {
    const draft = makeDraft()
    applyNonMessageProjectionEvent({
      draft,
      event: makeEvent({
        kind: 'tool_input_state',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        inputKind: 'approval',
        status: 'pending',
      }),
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Tool',
      summary: 'Tool running',
      inputState: { kind: 'approval', status: 'pending' },
    })
  })
})
