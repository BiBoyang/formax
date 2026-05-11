import { describe, expect, it } from 'vitest'
import { asThreadMessages, asThreadReplay } from './rpcParsers'

describe('rpcParsers', () => {
  it('parses thread message rows and filters invalid entries', () => {
    const parsed = asThreadMessages({
      data: [
        { id: 'm1', kind: 'message', role: 'assistant', text: 'hello' },
        {
          id: 't1',
          kind: 'tool',
          toolName: 'Bash',
          status: 'running',
          summary: 'Running',
          input: { command: 'pwd' },
          patchStartLineNumber: 12,
          detailLines: ['ok', 1],
        },
        { id: 'bad', kind: 'message', role: 'system', text: 'ignore' },
      ],
      nextCursor: 'cursor-1',
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'auto',
        triggerReason: { kind: 'auto_threshold' },
        preTokens: 1200,
        summaryKind: 'session_memory',
      },
    })

    expect(parsed.nextCursor).toBe('cursor-1')
    expect(parsed.data).toHaveLength(2)
    expect(parsed.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 1200,
      summaryKind: 'session_memory',
    })
    expect(parsed.data[0]).toMatchObject({ kind: 'message', text: 'hello' })
    expect(parsed.data[1]).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      status: 'running',
      input: { command: 'pwd' },
      patchStartLineNumber: 12,
    })
  })

  it('normalizes replay state and keeps only valid pending inputs', () => {
    const parsed = asThreadReplay({
      data: [{ replaySeq: 10, method: 'turn/event', params: { ok: true } }, { replaySeq: 'bad', method: 'x' }],
      nextCursor: 11,
      latestCursor: 12,
      hasGap: true,
      pendingSessionMemoryRestore: {
        schemaVersion: 1,
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['Recover plan context'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Finish restore utility',
        todoSummary: null,
      },
      state: {
        mode: 'unknown-mode',
        pendingInputCount: 3,
        canonicalProtocolAnomalyCount: -5,
        pendingInputs: [
          {
            inputId: 'i-1',
            threadId: 'th-1',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-10T00:00:00.000Z',
            expiresAt: '2026-02-10T00:05:00.000Z',
            payload: { toolName: 'Bash' },
          },
          {
            inputId: 'i-2',
            threadId: 'th-1',
            turnId: 'turn-1',
            toolUseId: 'tool-2',
            kind: 'approval',
            status: 'submitted',
            createdAt: '2026-02-10T00:00:00.000Z',
            expiresAt: '2026-02-10T00:05:00.000Z',
          },
        ],
        invariantIssues: [
          {
            kind: 'running_tool_after_terminal_turn',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
          },
          {
            kind: 'pending_input_after_terminal_turn',
            turnId: 'turn-1',
            inputId: 'i-1',
            toolUseId: 'tool-1',
          },
          {
            kind: 'pending_input_after_terminal_turn',
            turnId: 'turn-1',
            toolUseId: 'tool-2',
          },
          {
            kind: 'unknown',
            turnId: 'turn-1',
            toolUseId: 'tool-3',
          },
        ],
        updatedAt: '2026-02-10T00:06:00.000Z',
      },
    })

    expect(parsed.data).toHaveLength(1)
    expect(parsed.nextCursor).toBe(11)
    expect(parsed.latestCursor).toBe(12)
    expect(parsed.hasGap).toBe(true)
    expect(parsed.pendingSessionMemoryRestore).toEqual({
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/session.ts'],
      recentUserPrompts: ['Recover plan context'],
      planPath: '/repo/.formax/plan.md',
      planExcerpt: 'Finish restore utility',
      todoSummary: null,
    })
    expect(parsed.state?.mode).toBe('normal')
    expect(parsed.state?.pendingInputCount).toBe(3)
    expect(parsed.state?.canonicalProtocolAnomalyCount).toBe(0)
    expect(parsed.state?.pendingInputs).toHaveLength(1)
    expect(parsed.state?.pendingInputs[0]?.inputId).toBe('i-1')
    expect(parsed.state?.invariantIssues).toEqual([
      { kind: 'running_tool_after_terminal_turn', turnId: 'turn-1', toolUseId: 'tool-1' },
      { kind: 'pending_input_after_terminal_turn', turnId: 'turn-1', inputId: 'i-1', toolUseId: 'tool-1' },
    ])
  })

  it('preserves user/system projection segments from replay state snapshots', () => {
    const parsed = asThreadReplay({
      data: [],
      nextCursor: 2,
      latestCursor: 2,
      hasGap: false,
      state: {
        mode: 'normal',
        activeTurnId: null,
        lastTurnId: 'turn-1',
        lastTurnStatus: 'completed',
        pendingInputCount: 0,
        canonicalProtocolAnomalyCount: 0,
        pendingInputs: [],
        invariantIssues: [],
        projection: {
          segments: [
            {
              id: 'turn-1:user:1',
              kind: 'user',
              turnId: 'turn-1',
              text: 'hello',
              messageKind: 'compact_summary',
            },
            {
              id: 'turn-1:system:2',
              kind: 'system',
              turnId: 'turn-1',
              role: 'assistant',
              text: 'system note',
              messageKind: 'command_subline',
            },
            {
              id: 'turn-1:assistant:3',
              kind: 'assistant',
              turnId: 'turn-1',
              text: 'reply',
            },
            {
              id: 'turn-1:tool:4',
              kind: 'tool',
              turnId: 'turn-1',
              toolUseId: 'tool-1',
              toolName: 'Edit',
              status: 'completed',
              summary: 'Edit completed',
              detailLines: [],
              patchStartLineNumber: 22,
              input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
            },
          ],
          lastReplaySeq: 2,
          toolNameByUseId: {},
          openAssistantSegmentIdByTurn: {},
          openThinkingSegmentIdByTurn: {},
        },
        toolNameByUseId: {},
        updatedAt: '2026-02-10T00:06:00.000Z',
      },
    })

    expect(parsed.state?.projection?.segments).toMatchObject([
      { id: 'turn-1:user:1', kind: 'user', turnId: 'turn-1', text: 'hello', messageKind: 'compact_summary' },
      { id: 'turn-1:system:2', kind: 'system', turnId: 'turn-1', role: 'assistant', text: 'system note', messageKind: 'command_subline' },
      { id: 'turn-1:assistant:3', kind: 'assistant', turnId: 'turn-1', text: 'reply' },
      {
        id: 'turn-1:tool:4',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Edit',
        status: 'completed',
        summary: 'Edit completed',
        detailLines: [],
        patchStartLineNumber: 22,
        input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
      },
    ])
  })
})
