import { describe, expect, it } from 'vitest'
import { reduceTurnFooterEvent } from './transcriptProjectionTurnReducer'
import type { TranscriptSegment } from './transcriptProjectionTypes'

describe('transcriptProjectionTurnReducer', () => {
  it('finalizes running tools with failed status and preserves custom summaries', () => {
    const draft = {
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'u1',
          toolName: 'Bash',
          status: 'running',
          summary: 'custom summary',
          detailLines: [],
        },
        {
          id: 'tool-2',
          kind: 'tool',
          turnId: 'turn-2',
          toolUseId: 'u2',
          toolName: 'Read',
          status: 'running',
          summary: 'Read running',
          detailLines: [],
        },
      ] as TranscriptSegment[],
    }

    reduceTurnFooterEvent({
      draft,
      event: {
        kind: 'turn_footer',
        threadId: 'thread-1',
        eventId: 'f1',
        replaySeq: 10,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        status: 'failed',
      },
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      turnId: 'turn-1',
      status: 'error',
      summary: 'custom summary',
      terminalSource: 'turn_footer',
    })
    expect(draft.segments[1]).toMatchObject({
      kind: 'tool',
      turnId: 'turn-2',
      status: 'running',
      summary: 'Read running',
    })
  })

  it('sets abort result on interrupted footer and updates existing turn footer in place', () => {
    const draft = {
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'u1',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
        },
        {
          id: 'footer-1',
          kind: 'turn_footer',
          turnId: 'turn-1',
          status: 'completed',
        },
      ] as TranscriptSegment[],
    }

    reduceTurnFooterEvent({
      draft,
      event: {
        kind: 'turn_footer',
        threadId: 'thread-1',
        eventId: 'f2',
        replaySeq: 11,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        status: 'interrupted',
        message: 'stopped by user',
      },
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      status: 'error',
      summary: 'Bash interrupted',
      result: 'Error: stopped by user',
      terminalSource: 'turn_footer',
    })
    expect(draft.segments[1]).toMatchObject({
      kind: 'turn_footer',
      turnId: 'turn-1',
      status: 'interrupted',
      message: 'stopped by user',
    })
  })

  it('does not override tool result when interrupted footer has no message', () => {
    const draft = {
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'u1',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
          result: 'keep-me',
        },
      ] as TranscriptSegment[],
    }

    reduceTurnFooterEvent({
      draft,
      event: {
        kind: 'turn_footer',
        threadId: 'thread-1',
        eventId: 'f3',
        replaySeq: 12,
        ts: '2026-02-13T01:10:00.000Z',
        source: 'engine',
        turnId: 'turn-1',
        status: 'interrupted',
      },
      toSegmentId: ({ kind, replaySeq }) => `${kind}-${replaySeq}`,
    })

    expect(draft.segments[0]).toMatchObject({
      kind: 'tool',
      summary: 'Bash interrupted',
      result: 'keep-me',
    })
  })
})
