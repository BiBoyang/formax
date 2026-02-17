import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import {
  assertReplCanonicalInvariants,
  collectReplCanonicalInvariantIssues,
  summarizeReplCanonicalInvariantIssues,
} from './canonicalInvariants'

function createProjection(args: {
  segments: any[]
  openAssistantSegmentIdByTurn?: Record<string, string>
}): any {
  return {
    threadId: 'tui-live',
    segments: args.segments,
    seenEventIds: new Set<string>(),
    lastReplaySeq: 0,
    toolNameByUseId: {},
    openAssistantSegmentIdByTurn: args.openAssistantSegmentIdByTurn ?? {},
    openThinkingSegmentIdByTurn: {},
  }
}

describe('canonicalInvariants', () => {
  it('collects duplicate tool rows in one turn from transcript messages', () => {
    const messages: Msg[] = [
      { id: 'u1', role: 'user', content: 'run', timestamp: new Date(1) },
      {
        id: 't1',
        role: 'tool',
        content: '',
        timestamp: new Date(2),
        toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'running', input: {} },
      },
      {
        id: 't2',
        role: 'tool',
        content: '',
        timestamp: new Date(3),
        toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'completed', input: {} },
      },
    ]
    const issues = collectReplCanonicalInvariantIssues({
      projection: createProjection({ segments: [] }),
      messages,
    })
    expect(issues).toEqual([
      {
        kind: 'duplicate_tool_row_in_turn',
        turnAnchorMessageId: 'u1',
        toolUseId: 'dup-1',
      },
    ])
  })

  it('collects open assistant issue when terminal turn still has open assistant segment', () => {
    const issues = collectReplCanonicalInvariantIssues({
      projection: createProjection({
        segments: [
          {
            id: 'footer-1',
            kind: 'turn_footer',
            turnId: 'turn-1',
            status: 'completed',
            replaySeq: 1,
            ts: new Date(1).toISOString(),
          },
        ],
        openAssistantSegmentIdByTurn: { 'turn-1': 'assistant-open-1' },
      }),
      messages: [],
    })
    expect(issues).toEqual([
      {
        kind: 'open_assistant_after_terminal_turn',
        turnId: 'turn-1',
        openAssistantSegmentId: 'assistant-open-1',
      },
    ])
  })

  it('summarizes mixed invariant issues', () => {
    const summary = summarizeReplCanonicalInvariantIssues([
      {
        kind: 'duplicate_tool_row_in_turn',
        turnAnchorMessageId: 'u1',
        toolUseId: 'dup-1',
      },
      {
        kind: 'open_assistant_after_terminal_turn',
        turnId: 'turn-1',
        openAssistantSegmentId: 'assistant-open-1',
      },
    ])
    expect(summary).toBe('duplicate_tool_row_in_turn=1, open_assistant_after_terminal_turn=1')
  })

  it('throws once invariants are violated in non-production env', () => {
    expect(() =>
      assertReplCanonicalInvariants({
        projection: createProjection({ segments: [] }),
        messages: [
          { id: 'u1', role: 'user', content: 'run', timestamp: new Date(1) },
          {
            id: 't1',
            role: 'tool',
            content: '',
            timestamp: new Date(2),
            toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'running', input: {} },
          },
          {
            id: 't2',
            role: 'tool',
            content: '',
            timestamp: new Date(3),
            toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'completed', input: {} },
          },
        ],
      }),
    ).toThrow(/duplicate_tool_row_in_turn=1/i)
  })

  it('ignores historical duplicate tool rows when target turn anchor is provided', () => {
    const issues = collectReplCanonicalInvariantIssues({
      projection: createProjection({ segments: [] }),
      messages: [
        { id: 'u-old', role: 'user', content: 'old', timestamp: new Date(1) },
        {
          id: 't-old-1',
          role: 'tool',
          content: '',
          timestamp: new Date(2),
          toolInfo: { toolUseId: 'dup-old', name: 'Bash', status: 'running', input: {} },
        },
        {
          id: 't-old-2',
          role: 'tool',
          content: '',
          timestamp: new Date(3),
          toolInfo: { toolUseId: 'dup-old', name: 'Bash', status: 'completed', input: {} },
        },
        { id: 'u-new', role: 'user', content: 'new', timestamp: new Date(4) },
        {
          id: 't-new',
          role: 'tool',
          content: '',
          timestamp: new Date(5),
          toolInfo: { toolUseId: 'ok-new', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      targetTurnAnchorMessageId: 'u-new',
    })
    expect(issues).toEqual([])
  })
})
