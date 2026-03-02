import { describe, expect, it } from 'vitest'
import { createTranscriptSegmentId } from './transcriptProjectionIds'
import {
  dedupeAppend,
  findToolSegmentIndex,
  parseTimestampMs,
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
        middleLines: [' line-1 ', undefined as any, '   ', '', 'line-2'],
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

  it('dedupeAppend and parseTimestamp helpers handle blank/duplicate/invalid cases', () => {
    expect(dedupeAppend([], '  line-1  ')).toEqual(['line-1'])
    expect(dedupeAppend(['line-1'], 'line-1')).toEqual(['line-1'])
    expect(dedupeAppend(['line-1'], '   ')).toEqual(['line-1'])
    expect(parseTimestampMs('invalid-ts')).toBeNull()
    expect(typeof parseTimestampMs('2026-02-13T01:10:00.000Z')).toBe('number')
  })

  it('findToolSegmentIndex scans from tail and ignores non-tool/wrong-turn/wrong-use-id rows', () => {
    const segments: TranscriptSegment[] = [
      { id: 's0', kind: 'assistant', turnId: 'turn-1', text: 'a' },
      {
        id: 's1',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-x',
        toolName: 'Read',
        status: 'running',
        summary: 'Read running',
        detailLines: [],
      },
      {
        id: 's2',
        kind: 'tool',
        turnId: 'turn-2',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'running',
        summary: 'Bash running',
        detailLines: [],
      },
      {
        id: 's3',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'running',
        summary: 'Bash running',
        detailLines: [],
      },
    ]

    expect(findToolSegmentIndex({ segments, turnId: 'turn-1', toolUseId: 'tool-1' })).toBe(3)
    expect(findToolSegmentIndex({ segments, turnId: 'turn-1', toolUseId: 'missing' })).toBe(-1)
  })

  it('updates existing tool segment on end event with computed duration and terminal metadata', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
          startedAtMs: Date.parse('2026-02-13T01:10:00.000Z'),
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-end',
        replaySeq: 2,
        ts: '2026-02-13T01:10:05.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        phase: 'end',
        isError: false,
        toolName: 'Bash',
        line: 'done-line',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      terminalSource: 'tool_event',
      summary: 'done-line',
      detailLines: ['done-line'],
      durationMs: 5000,
      startedAtMs: Date.parse('2026-02-13T01:10:00.000Z'),
    })
  })

  it('creates tool segment with default tool name and completed fallback summary when end event has no text', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-end-2',
        replaySeq: 3,
        ts: '2026-02-13T01:10:06.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-9',
        phase: 'end',
        isError: false,
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Tool',
      status: 'completed',
      summary: 'Tool completed',
      terminalSource: 'tool_event',
      detailLines: [],
    })
  })

  it('applies optional tool event fields when provided and preserves explicit duration', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-start-3',
        replaySeq: 4,
        ts: '2026-02-13T01:10:07.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-3',
        phase: 'start',
        toolName: 'Edit',
        input: { file_path: 'a.ts' },
        result: 'ok',
        resultLines: 3,
        expandInfo: { payload: 1 } as any,
        transcriptLines: ['t1'],
        nestedTools: [{ id: 'n1', name: 'Read' }] as any,
        toolUses: 2,
        usage: { input_tokens: 1, output_tokens: 2 } as any,
        durationMs: 7,
        patchStartLineNumber: 10,
        paramsText: 'file_path=\"a.ts\"',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Edit',
      status: 'running',
      summary: 'Edit running',
      input: { file_path: 'a.ts' },
      result: 'ok',
      resultLines: 3,
      expandInfo: { payload: 1 },
      transcriptLines: ['t1'],
      nestedTools: [{ id: 'n1', name: 'Read' }],
      toolUses: 2,
      usage: { input_tokens: 1, output_tokens: 2 },
      durationMs: 7,
      patchStartLineNumber: 10,
      paramsText: 'file_path=\"a.ts\"',
    })
  })

  it('updates existing tool input state and rebinds running summary when tool name changes', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-2',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-2',
          toolName: 'Read',
          status: 'running',
          summary: 'Read running',
          detailLines: [],
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolInputStateEvent({
      draft,
      event: {
        kind: 'tool_input_state',
        threadId: 'thread-1',
        eventId: 'e-input-2',
        replaySeq: 5,
        ts: '2026-02-13T01:10:08.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-2',
        toolName: 'Write',
        inputKind: 'approval',
        status: 'pending',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Write',
      summary: 'Write running',
      inputState: { kind: 'approval', status: 'pending' },
    })
  })

  it('uses cached tool name for input-state-only events when event toolName is missing', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: { 'tool-7': 'CachedTool' },
    }

    reduceToolInputStateEvent({
      draft,
      event: {
        kind: 'tool_input_state',
        threadId: 'thread-1',
        eventId: 'e-input-3',
        replaySeq: 6,
        ts: '2026-02-13T01:10:09.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-7',
        inputKind: 'approval',
        status: 'submitted',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'CachedTool',
      summary: 'CachedTool running',
      inputState: { kind: 'approval', status: 'submitted' },
    })
  })

  it('updates existing non-running tool segment and preserves explicit terminal source on non-end event', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-3',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-3',
          toolName: 'Read',
          status: 'completed',
          terminalSource: 'tool_event',
          summary: 'Read completed',
          detailLines: [],
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-update-existing',
        replaySeq: 7,
        ts: 'invalid-ts',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-3',
        phase: 'update',
        toolName: 'Write',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Write',
      status: 'completed',
      terminalSource: 'tool_event',
      summary: 'Write completed',
      detailLines: [],
    })
    expect((draft.segments[0] as any).startedAtMs).toBeUndefined()
    expect((draft.segments[0] as any).durationMs).toBeUndefined()
  })

  it('updates existing tool segment with optional fields and middleLines that include nullish entries', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-4',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-4',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: ['old-line'],
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-update-optional',
        replaySeq: 8,
        ts: '2026-02-13T01:10:10.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-4',
        phase: 'update',
        toolName: 'Bash',
        input: { cmd: 'pwd' },
        result: 'ok',
        resultLines: 1,
        expandInfo: { panel: true } as any,
        middleLines: [' out-1 ', undefined as any, '', 'out-2'],
        transcriptLines: ['t-1'],
        nestedTools: [{ id: 'nested-1', name: 'Read' }] as any,
        toolUses: 3,
        usage: { input_tokens: 3, output_tokens: 4 } as any,
        durationMs: 9,
        patchStartLineNumber: 11,
        paramsText: 'cmd="pwd"',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      status: 'running',
      summary: 'Bash running',
      detailLines: ['out-1', 'out-2'],
      input: { cmd: 'pwd' },
      result: 'ok',
      resultLines: 1,
      expandInfo: { panel: true },
      middleLines: [' out-1 ', undefined, '', 'out-2'],
      transcriptLines: ['t-1'],
      nestedTools: [{ id: 'nested-1', name: 'Read' }],
      toolUses: 3,
      usage: { input_tokens: 3, output_tokens: 4 },
      durationMs: 9,
      patchStartLineNumber: 11,
      paramsText: 'cmd="pwd"',
    })
  })

  it('uses fallback summary and error status for new terminal tool events', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-error',
        replaySeq: 9,
        ts: '2026-02-13T01:10:11.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-err',
        phase: 'end',
        isError: true,
        toolName: 'Bash',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      status: 'error',
      terminalSource: 'tool_event',
      summary: 'Bash completed',
      detailLines: [],
    })
  })

  it('falls back to literal Tool name for input-state events when neither event nor cache contains toolName', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [],
      toolNameByUseId: {},
    }

    reduceToolInputStateEvent({
      draft,
      event: {
        kind: 'tool_input_state',
        threadId: 'thread-1',
        eventId: 'e-input-4',
        replaySeq: 10,
        ts: '2026-02-13T01:10:12.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-unknown',
        inputKind: 'approval',
        status: 'pending',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Tool',
      summary: 'Tool running',
      inputState: { kind: 'approval', status: 'pending' },
    })
  })

  it('uses fallback end summary and error status when updating an existing running tool', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-existing-end-error',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-5',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-existing-end-error',
        replaySeq: 11,
        ts: '2026-02-13T01:10:13.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-5',
        phase: 'end',
        isError: true,
        toolName: 'Bash',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      status: 'error',
      terminalSource: 'tool_event',
      summary: 'Bash completed',
    })
  })

  it('sets startedAtMs from event timestamp when updating an existing tool on start phase', () => {
    const draft: { segments: TranscriptSegment[]; toolNameByUseId: Record<string, string> } = {
      segments: [
        {
          id: 'tool-seg-existing-start',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-6',
          toolName: 'Read',
          status: 'running',
          summary: 'Read running',
          detailLines: [],
        },
      ],
      toolNameByUseId: {},
    }

    reduceToolEvent({
      draft,
      event: {
        kind: 'tool_event',
        threadId: 'thread-1',
        eventId: 'e-tool-existing-start',
        replaySeq: 12,
        ts: '2026-02-13T01:10:14.000Z',
        source: 'engine',
        turnId: 'turn-1',
        toolUseId: 'tool-6',
        phase: 'start',
        toolName: 'Read',
      },
      toSegmentId: createTranscriptSegmentId,
    })

    expect((draft.segments[0] as any).startedAtMs).toBe(Date.parse('2026-02-13T01:10:14.000Z'))
  })
})
