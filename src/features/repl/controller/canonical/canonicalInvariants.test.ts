import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
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

  it('summarizes empty issues as none', () => {
    expect(summarizeReplCanonicalInvariantIssues([])).toBe('none')
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

  it('does not throw in production env', () => {
    vi.stubEnv('NODE_ENV', 'production')
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
    ).not.toThrow()
    vi.unstubAllEnvs()
  })

  it('does not throw when no invariant issue exists in non-production env', () => {
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
            toolInfo: { toolUseId: 'ok-1', name: 'Bash', status: 'completed', input: {} },
          },
        ],
      }),
    ).not.toThrow()
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

  it('filters terminal-turn selector issues by targetTurnId', () => {
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
          {
            id: 'tool-running-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            toolName: 'Bash',
            status: 'running',
            summary: 'Bash running',
            detailLines: [],
          },
        ],
      }),
      messages: [],
      targetTurnId: 'turn-2',
    })

    expect(issues).toEqual([])
  })

  it('collects duplicate issues from an explicit target turn anchor in current turn', () => {
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
        openAssistantSegmentIdByTurn: {
          'turn-1': 'open-assistant-1',
        },
      }),
      messages: [
        { id: 'u1', role: 'user', content: 'run', timestamp: new Date(1) },
        { id: 'a1', role: 'assistant', content: 'working', timestamp: new Date(2) },
        {
          id: 't1',
          role: 'tool',
          content: '',
          timestamp: new Date(3),
          toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'running', input: {} },
        },
        {
          id: 't2',
          role: 'tool',
          content: '',
          timestamp: new Date(4),
          toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      targetTurnAnchorMessageId: 'u1',
      targetTurnId: 'turn-1',
    })

    expect(issues).toEqual([
      {
        kind: 'open_assistant_after_terminal_turn',
        turnId: 'turn-1',
        openAssistantSegmentId: 'open-assistant-1',
      },
      {
        kind: 'duplicate_tool_row_in_turn',
        turnAnchorMessageId: 'u1',
        toolUseId: 'dup-1',
      },
    ])
  })

  it('skips non-tool rows and blank toolUseId while scanning turn tail', () => {
    const issues = collectReplCanonicalInvariantIssues({
      projection: createProjection({ segments: [] }),
      messages: [
        { id: 'sys1', role: 'system', content: 'prelude', timestamp: new Date(1) },
        { id: 'a1', role: 'assistant', content: 'thinking', timestamp: new Date(2) },
        { id: 't-blank', role: 'tool', content: '', timestamp: new Date(3), toolInfo: { toolUseId: '  ' } as any },
        { id: 'u1', role: 'user', content: 'run', timestamp: new Date(4) },
        { id: 'u2', role: 'user', content: 'next turn', timestamp: new Date(5) },
        {
          id: 't-next',
          role: 'tool',
          content: '',
          timestamp: new Date(6),
          toolInfo: { toolUseId: 'dup-next', name: 'Bash', status: 'running', input: {} },
        },
        {
          id: 't-next-2',
          role: 'tool',
          content: '',
          timestamp: new Date(7),
          toolInfo: { toolUseId: 'dup-next', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      targetTurnAnchorMessageId: 'u1',
    })

    expect(issues).toEqual([])
  })

  it('uses __prelude__ anchor when no user row exists in the scanned range', () => {
    const issues = collectReplCanonicalInvariantIssues({
      projection: createProjection({ segments: [] }),
      messages: [
        undefined as unknown as Msg,
        {
          id: 'tool-1',
          role: 'tool',
          content: '',
          timestamp: new Date(1),
          toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'running', input: {} },
        },
        {
          id: 'tool-2',
          role: 'tool',
          content: '',
          timestamp: new Date(2),
          toolInfo: { toolUseId: 'dup-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(issues).toEqual([
      {
        kind: 'duplicate_tool_row_in_turn',
        turnAnchorMessageId: '__prelude__',
        toolUseId: 'dup-1',
      },
    ])
  })
})
