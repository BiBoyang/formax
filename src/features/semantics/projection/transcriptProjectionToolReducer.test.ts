import { describe, expect, it } from 'vitest'
import { createTranscriptSegmentId } from './transcriptProjectionIds'
import {
  rebindToolSummaryForName,
  reduceToolEvent,
  reduceToolInputStateEvent,
} from './transcriptProjectionToolReducer'
import type { TranscriptSegment } from './transcriptProjectionTypes'

describe('transcriptProjectionToolReducer', () => {
  it('rebinds completed template summary and preserves custom summary', () => {
    expect(
      rebindToolSummaryForName({
        summary: 'Write completed',
        currentToolName: 'Write',
        nextToolName: 'Edit',
        status: 'completed',
      }),
    ).toBe('Edit completed')

    expect(
      rebindToolSummaryForName({
        summary: 'custom summary',
        currentToolName: 'Write',
        nextToolName: 'Edit',
        status: 'completed',
      }),
    ).toBe('custom summary')
  })

  it('creates tool segment from middleLines and filters empty lines', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-1',
        replaySeq: 1,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        phase: 'start',
        toolName: 'Bash',
        middleLines: [' line-1 ', '   ', '', 'line-2'],
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments).toHaveLength(1)
    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      detailLines: ['line-1', 'line-2'],
    })
  })

  it('stores toolName from tool_input_state events and creates inputState segment when missing', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolInputStateEvent({
      draft,
      event: {
        kind: 'tool_input_state',
        threadId: 'thread-1',
        eventId: 'e-input-1',
        replaySeq: 2,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-2',
        toolName: 'Read',
        inputKind: 'approval',
        status: 'pending',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.toolNameByUseId['tool-2']).toBe('Read')
    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolUseId: 'tool-2',
      toolName: 'Read',
      inputState: { kind: 'approval', status: 'pending' },
    })
  })
})
