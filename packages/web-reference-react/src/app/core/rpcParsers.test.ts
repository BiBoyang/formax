import { describe, expect, it } from 'vitest'
import { asThreadMessages, asThreadReplay } from './rpcParsers'

describe('rpcParsers', () => {
  it('omits malformed-present thread/messages compression facts instead of coercing them to null', () => {
    const parsed = asThreadMessages({
      data: [],
      latestCompactBoundary: { schemaVersion: 2, trigger: 'auto' },
      durableSnip: { stage: 'snip', status: 'active' },
      latestRequestCollapse: { phase: 'initial' },
    })

    expect(Object.prototype.hasOwnProperty.call(parsed, 'latestCompactBoundary')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'durableSnip')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'latestRequestCollapse')).toBe(false)
  })

  it('preserves explicit null thread/messages compression facts as authoritative clears', () => {
    const parsed = asThreadMessages({
      data: [],
      latestCompactBoundary: null,
      durableSnip: null,
      latestRequestCollapse: null,
    })

    expect(parsed).toMatchObject({
      latestCompactBoundary: null,
      durableSnip: null,
      latestRequestCollapse: null,
    })
  })

  it('omits malformed optional preservedSegment identity details without dropping core facts', () => {
    const parsed = asThreadMessages({
      data: [],
      latestCompactBoundary: {
        schemaVersion: 1,
        preservedSegment: {
          schemaVersion: 1,
          continuationMessageCount: 2,
          preservedTailMessageCount: 1,
          summaryFingerprint: 'summary-fp',
          headFingerprint: 'tail-fp',
          tailFingerprint: 'tail-fp',
          messageIdentities: [{ schemaVersion: 1, id: '', parentId: null, fingerprint: 'tail-fp', source: 'explicit' }],
          headIdentity: { schemaVersion: 1, id: '', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
        },
      },
    })

    expect(parsed.latestCompactBoundary?.preservedSegment).toEqual({
      schemaVersion: 1,
      continuationMessageCount: 2,
      preservedTailMessageCount: 1,
      summaryFingerprint: 'summary-fp',
      headFingerprint: 'tail-fp',
      tailFingerprint: 'tail-fp',
    })
  })

  it('omits absent thread/messages compression facts', () => {
    const parsed = asThreadMessages({ data: [] })

    expect(Object.prototype.hasOwnProperty.call(parsed, 'latestCompactBoundary')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'durableSnip')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'latestRequestCollapse')).toBe(false)
  })

  it('does not infer uncontracted compression facts from transcript rows or unknown fields', () => {
    const parsed = asThreadMessages({
      data: [
        {
          id: 'tool-1',
          kind: 'tool',
          toolName: 'Read',
          status: 'completed',
          summary: '[Tool result replaced by budget: Read /repo/a.ts]',
          detailLines: ['durable tool-result replacement marker: tool-1', 'reactive_compact_applied session event'],
        },
      ],
      durableToolResultContentReplacement: {
        status: 'active',
        replacementContent: '[durable replacement should be ignored]',
      },
      latestReactiveCompact: {
        triggerKind: 'maximum_context_length',
        strategy: 'model_summary',
      },
    } as any)

    expect(parsed.data).toEqual([
      expect.objectContaining({
        kind: 'tool',
        toolName: 'Read',
        summary: '[Tool result replaced by budget: Read /repo/a.ts]',
        detailLines: ['durable tool-result replacement marker: tool-1', 'reactive_compact_applied session event'],
      }),
    ])
    expect(Object.prototype.hasOwnProperty.call(parsed, 'durableToolResultContentReplacement')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsed, 'latestReactiveCompact')).toBe(false)
  })

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
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 3,
          keepMinTokens: 800,
          keepMinUserTurns: 2,
        },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [
            { kind: 'recent_files', priority: 'high', status: 'applied' },
            { kind: 'plan_state', priority: 'medium', status: 'planned' },
          ],
        },
        rehydrationCost: {
          sectionCount: 2,
          estimatedTokens: 144,
        },
        preservedSegment: {
          schemaVersion: 1,
          continuationMessageCount: 4,
          preservedTailMessageCount: 2,
          summaryFingerprint: 'summary-fp',
          headFingerprint: 'head-fp',
          tailFingerprint: 'tail-fp',
          messageFingerprints: ['summary-fp', 'head-fp', 'middle-fp', 'tail-fp'],
          messageIdentities: [
            { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
            { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
            { schemaVersion: 1, id: 'middle-id', parentId: null, fingerprint: 'middle-fp', source: 'legacy_fallback' },
            { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
          ],
          summaryIdentity: { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
          headIdentity: { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
          anchorIdentity: { schemaVersion: 1, id: 'middle-id', parentId: null, fingerprint: 'middle-fp', source: 'legacy_fallback' },
          tailIdentity: { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
        },
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
      keepStrategy: {
        kind: 'keep_combo',
        keepLastTurns: 3,
        keepMinTokens: 800,
        keepMinUserTurns: 2,
      },
      rehydrationPlan: {
        schemaVersion: 1,
        items: [
          { kind: 'recent_files', priority: 'high', status: 'applied' },
          { kind: 'plan_state', priority: 'medium', status: 'planned' },
        ],
      },
      rehydrationCost: {
        sectionCount: 2,
        estimatedTokens: 144,
      },
      preservedSegment: {
        schemaVersion: 1,
        continuationMessageCount: 4,
        preservedTailMessageCount: 2,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'tail-fp',
        messageFingerprints: ['summary-fp', 'head-fp', 'middle-fp', 'tail-fp'],
        messageIdentities: [
          { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
          { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
          { schemaVersion: 1, id: 'middle-id', parentId: null, fingerprint: 'middle-fp', source: 'legacy_fallback' },
          { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
        ],
        summaryIdentity: { schemaVersion: 1, id: 'summary-id', parentId: null, fingerprint: 'summary-fp', source: 'explicit' },
        headIdentity: { schemaVersion: 1, id: 'head-id', parentId: null, fingerprint: 'head-fp', source: 'explicit' },
        anchorIdentity: { schemaVersion: 1, id: 'middle-id', parentId: null, fingerprint: 'middle-fp', source: 'legacy_fallback' },
        tailIdentity: { schemaVersion: 1, id: 'tail-id', parentId: null, fingerprint: 'tail-fp', source: 'explicit' },
      },
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
        recentSkills: ['formax-dev-loop-workflow'],
        recentSubagentTypes: ['Explore'],
        recentDeferredToolNames: ['Bash', 'Read'],
        recentTaskHints: ['Explore: audit restore state'],
      recentTaskContinuityHints: [],
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
      recentSkills: ['formax-dev-loop-workflow'],
      recentSubagentTypes: ['Explore'],
      recentDeferredToolNames: ['Bash', 'Read'],
      recentTaskHints: ['Explore: audit restore state'],
      recentTaskContinuityHints: [],
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

  it('keeps schema-v1 restore summaries compatible when higher-order fields are absent', () => {
    const parsed = asThreadReplay({
      data: [],
      nextCursor: 0,
      latestCursor: 0,
      hasGap: false,
      pendingSessionMemoryRestore: {
        schemaVersion: 1,
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['Recover plan context'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Finish restore utility',
        todoSummary: null,
      },
    })

    expect(parsed.pendingSessionMemoryRestore).toEqual({
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/session.ts'],
      recentUserPrompts: ['Recover plan context'],
      recentSkills: [],
      recentSubagentTypes: [],
      recentDeferredToolNames: [],
      recentTaskHints: [],
      recentTaskContinuityHints: [],
      planPath: '/repo/.formax/plan.md',
      planExcerpt: 'Finish restore utility',
      todoSummary: null,
    })
  })

  it('omits malformed pending restore summaries instead of converting them to explicit null', () => {
    const parsed = asThreadReplay({
      data: [],
      nextCursor: 0,
      latestCursor: 0,
      hasGap: false,
      pendingSessionMemoryRestore: {
        schemaVersion: 1,
        mode: 'plan',
        recentFiles: 'not-an-array',
        recentUserPrompts: ['Recover plan context'],
        planPath: null,
        planExcerpt: null,
        todoSummary: null,
      },
    })

    expect(Object.prototype.hasOwnProperty.call(parsed, 'pendingSessionMemoryRestore')).toBe(false)
  })

  it('preserves explicit null pending restore summaries as authoritative clears', () => {
    const parsed = asThreadReplay({
      data: [],
      nextCursor: 0,
      latestCursor: 0,
      hasGap: false,
      pendingSessionMemoryRestore: null,
    })

    expect(parsed.pendingSessionMemoryRestore).toBeNull()
  })

  it('parses additive v8 restore hints and drops malformed optional hint rows', () => {
    const parsed = asThreadReplay({
      data: [],
      nextCursor: 0,
      latestCursor: 0,
      hasGap: false,
      pendingSessionMemoryRestore: {
        schemaVersion: 1,
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['Recover plan context'],
        recentSkills: [],
        recentSubagentTypes: [],
        recentDeferredToolNames: ['Bash'],
        recentTaskHints: ['Code: patch parser'],
        recentTaskContinuityHints: [
          {
            schemaVersion: 1,
            subagentType: 'Code',
            description: 'patch parser',
            runInBackgroundRequested: false,
            resumeHint: 'task-123',
            lastObservedStatus: 'completed',
            lastSummary: 'Parser summary',
            evidenceSource: 'task_tool_result',
            evidenceConfidence: 'high',
          },
          { schemaVersion: 1, subagentType: '', description: 'drop me' },
        ],
        restoreDiagnostics: {
          schemaVersion: 1,
          status: 'pending',
          source: 'session_memory_sidecar',
          confidence: 'high',
        },
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Finish restore utility',
        todoSummary: null,
      },
    })

    expect(parsed.pendingSessionMemoryRestore?.recentTaskContinuityHints).toEqual([
      {
        schemaVersion: 1,
        subagentType: 'Code',
        description: 'patch parser',
        runInBackgroundRequested: false,
        resumeHint: 'task-123',
        lastObservedStatus: 'completed',
        lastSummary: 'Parser summary',
        evidenceSource: 'task_tool_result',
        evidenceConfidence: 'high',
      },
    ])
    expect(parsed.pendingSessionMemoryRestore?.restoreDiagnostics).toEqual({
      schemaVersion: 1,
      status: 'pending',
      source: 'session_memory_sidecar',
      confidence: 'high',
    })
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
