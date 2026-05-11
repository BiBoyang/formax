import { describe, expect, it } from 'vitest'
import {
  analyzeContextDiagnostics,
  analyzeNextTurnFixedContext,
  buildContextDiagnosticsJson,
  formatContextDiagnosticsReport,
  resolveContextDiagnosticsOutputFormat,
} from './contextDiagnostics'
import type { PromptBlock, PromptMessage } from '../../prompts'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  buildDefaultCompactRehydrationPlan,
  estimateCompactRehydrationCost,
  getContinuationMessagesAfterLatestCompactBoundary,
  markCompactRehydrationApplied,
  rebuildHistoryAfterCompaction,
  resolveHistoryForCompaction,
} from './compact'
import { estimatePromptTokens } from './estimate'
import { buildPostCompactRehydration } from './postCompactRehydration'
import { buildSessionMemoryCompactionRehydration, buildSessionMemoryCompactionSummary, buildSessionMemoryDraft } from './sessionMemory'

describe('contextDiagnostics', () => {
  it('analyzes prompt slices, counts tool results, and detects microcompacted stubs', () => {
    const system: PromptBlock[] = [{ type: 'text', text: 'system instructions' }]
    const messages: PromptMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } }] as any,
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'read-1',
            content: '[Older tool result cleared by microcompact: Read /repo/a.ts]',
          },
          { type: 'text', text: 'extra context' },
        ] as any,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I found the issue in auth flow.' }],
      },
    ]

    const out = analyzeContextDiagnostics({
      system,
      messages,
      budgetConfig: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 12_000,
      },
    })

    expect(out.contextWindowTokens).toBe(100_000)
    expect(out.effectiveLimitTokens).toBe(95_000)
    expect(out.autoCompactLimitTokens).toBe(85_500)
    expect(out.baselineTokens).toBe(12_000)
    expect(out.messageCount).toBe(3)
    expect(out.userMessageCount).toBe(1)
    expect(out.assistantMessageCount).toBe(2)
    expect(out.toolResultBlockCount).toBe(1)
    expect(out.microCompactedToolResultCount).toBe(1)
    expect(out.toolResultCountsByToolName).toEqual([{ toolName: 'Read', count: 1 }])
    expect(out.microCompactedCountsByToolName).toEqual([{ toolName: 'Read', count: 1 }])
    expect(out.systemSectionBreakdown.length).toBe(1)
    expect(out.systemSectionBreakdown[0]).toEqual({
      kind: 'system_section',
      key: 'system_section:identity',
      label: 'System section: Identity',
      tokens: out.systemTokens,
      systemSectionKey: 'identity',
    })
    expect(out.topSnapshotContributors.length).toBeGreaterThan(0)
    expect(out.topSnapshotContributors.some((row) => row.label === 'System section: Identity')).toBe(true)
    expect(out.topSnapshotContributors.some((row) => row.label.includes('Tool result: Read /repo/a.ts'))).toBe(true)
    expect(
      out.topSnapshotContributors.some(
        (row) =>
          row.kind === 'tool_result' &&
          row.toolUseId === 'read-1' &&
          row.toolName === 'Read' &&
          row.ordinal === 1 &&
          row.role === 'user',
      ),
    ).toBe(true)
    expect(out.totalTokens).toBeGreaterThan(0)
    expect(out.systemTokens).toBeGreaterThan(0)
    expect(out.historyTokens).toBeGreaterThan(0)
    expect(out.toolResultTokens).toBeGreaterThan(0)
    expect(out.otherHistoryTokens).toBeGreaterThan(0)
    expect(out.remainingToEffectiveLimit).toBeLessThan(95_000)
    expect(out.shouldAutoCompact).toBe(false)
  })

  it('ignores explicit compact boundary messages in snapshot counts', () => {
    const out = analyzeContextDiagnostics({
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [
        buildCompactBoundaryMessage({
          trigger: 'manual',
          preTokens: 42,
          summaryKind: 'model_summary',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 0 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'next step' }] },
      ],
      budgetConfig: null,
    })

    expect(out.messageCount).toBe(2)
    expect(out.userMessageCount).toBe(1)
    expect(out.assistantMessageCount).toBe(1)
    expect(out.topSnapshotContributors.some((row) => row.label.includes('Assistant message'))).toBe(true)
  })

  it('uses only the latest compact-boundary continuation view in diagnostics', () => {
    const out = analyzeContextDiagnostics({
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [
        buildCompactBoundaryMessage({
          trigger: 'manual',
          preTokens: 42,
          summaryKind: 'model_summary',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary-1' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'tail-1' }] },
        buildCompactBoundaryMessage({
          trigger: 'auto',
          preTokens: 88,
          summaryKind: 'session_memory',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary-2' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'tail-2' }] },
      ],
      budgetConfig: null,
    })

    expect(out.messageCount).toBe(2)
    expect(out.userMessageCount).toBe(1)
    expect(out.assistantMessageCount).toBe(1)
    expect(out.topSnapshotContributors.some((row) => row.label.includes('tail-1'))).toBe(false)
    expect(out.topSnapshotContributors.some((row) => row.label.includes('summary-2'))).toBe(true)
  })

  it('formats a readable diagnostics report with unknown budget values', () => {
    const diagnostics = analyzeContextDiagnostics({
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    const out = formatContextDiagnosticsReport({
      diagnostics,
      mode: 'plan',
      model: 'claude-3-5-sonnet-latest',
    })

    expect(out).toContain('Context diagnostics')
    expect(out).toContain('- Snapshot: latest compact-boundary continuation view only')
    expect(out).toContain('- Mode: plan')
    expect(out).toContain('- Model: claude-3-5-sonnet-latest')
    expect(out).toContain('- Context window: unknown')
    expect(out).toContain('- Tool result blocks: 0')
    expect(out).toContain('- Tool-result tool mix: none')
    expect(out).toContain('- Rehydration cost: none')
    expect(out).toContain('- Preserved segment: none')
    expect(out).toContain('System prompt breakdown')
    expect(out).toContain('- System section: Identity: 18')
    expect(out).toContain('Top snapshot contributors')
    expect(out).toContain('Next-turn fixed context (before future user text)')
    expect(out).toContain('- Projected history before middle-layer strategies: 22')
    expect(out).toContain('- Projected history after budget reducers (pre-collapse/prune): unknown')
    expect(out).toContain('- Estimated tokens saved by microcompact: 0')
    expect(out).toContain('- Microcompact compacted blocks: 0')
    expect(out).toContain('- Microcompact compacted tools: none')
    expect(out).toContain('- Microcompact cache-aware eligible tools: none')
    expect(out).toContain('- Microcompact cache-aware minimum chars: 0')
    expect(out).toContain('- Microcompact cache-aware compacted blocks: 0')
    expect(out).toContain('- Microcompact cache-aware compacted tools: none')
    expect(out).toContain('- Collapse applied for request projection: unknown')
    expect(out).toContain('- Estimated tokens saved by collapse: 0')
    expect(out).toContain('- Collapse recap metadata: none')
    expect(out).toContain('- Fixed group breakdown: none')
    expect(out).toContain('Assembled payload ledger before future user text')
    expect(out).toContain('- Assembled ledger: none')
    expect(out).toContain('Lifecycle markers before future user text')
    expect(out).toContain('Top assembled contributors before future user text')
    expect(out).toContain('Notes')
    expect(out).toContain('latest compact-boundary continuation view')
  })

  it('splits system prompt into identity, preamble, and top-level sections', () => {
    const out = analyzeContextDiagnostics({
      system: [
        { type: 'text', text: 'You are Formax.' },
        {
          type: 'text',
          text: '\nLead paragraph before headings.\n\n# System\nalpha\n\n# Doing tasks\nbeta\n\n# Environment\ngamma',
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    expect(out.systemSectionBreakdown.map((row) => row.label)).toEqual([
      'System section: Identity',
      'System section: Preamble',
      'System section: System',
      'System section: Doing tasks',
      'System section: Environment',
    ])
    expect(out.systemSectionBreakdown.map((row) => row.systemSectionKey)).toEqual([
      'identity',
      'preamble:1',
      'section:1:system:1',
      'section:1:doing_tasks:1',
      'section:1:environment:1',
    ])
    expect(out.topSnapshotContributors.some((row) => row.label === 'System section: Doing tasks')).toBe(true)
    expect(out.topSnapshotContributors.some((row) => row.label === 'System prompt')).toBe(false)
  })

  it('keeps a visible system contributor for non-text system blocks', () => {
    const out = analyzeContextDiagnostics({
      system: [
        { type: 'thinking', thinking: 'internal system scratchpad' } as any,
        { type: 'text', text: '# System\nvisible section' },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    expect(out.systemSectionBreakdown.some((row) => row.label === 'System section: Other blocks')).toBe(true)
    expect(out.topSnapshotContributors.some((row) => row.label === 'System section: Other blocks')).toBe(true)
  })

  it('disambiguates repeated top-level system headings with distinct section keys', () => {
    const out = analyzeContextDiagnostics({
      system: [
        {
          type: 'text',
          text: 'You are Formax.\n\n# Constraints\nalpha\n\n# Constraints\nbeta',
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    expect(out.systemSectionBreakdown.map((row) => row.systemSectionKey)).toEqual([
      'preamble:0',
      'section:0:constraints:1',
      'section:0:constraints:2',
    ])
  })

  it('treats the first text-only system block as identity even when non-text blocks precede it', () => {
    const out = analyzeContextDiagnostics({
      system: [
        { type: 'thinking', thinking: 'prelude metadata' } as any,
        { type: 'text', text: 'You are Formax.' },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    expect(out.systemSectionBreakdown.map((row) => row.label)).toEqual([
      'System section: Identity',
      'System section: Other blocks',
    ])
  })

  it('analyzes next-turn fixed context projection with group breakdown', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'plan',
      planPath: null,
      enableAutoCompact: true,
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'a'.repeat(4000) }] as any,
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: '/repo/b.ts' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-2', content: 'b'.repeat(4000) }] as any,
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-3', name: 'Read', input: { file_path: '/repo/c.ts' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-3', content: 'c'.repeat(4000) }] as any,
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-4', name: 'Read', input: { file_path: '/repo/d.ts' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-4', content: 'd'.repeat(4000) }] as any,
        },
      ],
      fixedGroups: [
        {
          label: 'Mode semantic blocks',
          blocks: [{ type: 'text', text: '<system-reminder>Plan mode is active.</system-reminder>' }],
        },
        {
          label: 'Pending injected blocks',
          blocks: [{ type: 'text', text: '<local-command-stdout>saved settings</local-command-stdout>' }],
        },
      ],
      budgetConfig: {
        contextWindowTokens: 6_000,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 0,
      },
    })

    expect(out.fixedGroups.map((row) => row.label)).toEqual(['Mode semantic blocks', 'Pending injected blocks'])
    expect(out.assembledLedger.map((row) => row.kind)).toEqual([
      'system_total',
      'request_history',
      'tool_result_group',
      'tool_result_budget_savings',
      'fixed_group',
      'fixed_group',
      'fixed_total',
      'assembled_total',
    ])
    expect(out.assembledLedger[0]).toMatchObject({
      kind: 'system_total',
      key: 'system_total',
      label: 'System prompt total',
    })
    expect(out.assembledLedger[1]).toMatchObject({
      kind: 'request_history',
      key: 'request_history',
    })
    expect(out.assembledLedger[2]).toMatchObject({
      kind: 'tool_result_group',
      key: 'tool_result_group',
    })
    expect(out.assembledLedger[3]).toMatchObject({
      kind: 'tool_result_budget_savings',
      key: 'tool_result_budget_savings',
    })
    expect(out.assembledLedger[4]).toMatchObject({
      kind: 'fixed_group',
      label: 'Mode semantic blocks',
      blockCount: 1,
    })
    expect(out.toolResultBudgetImpact.totalToolResultTokensBefore).toBeGreaterThanOrEqual(
      out.toolResultBudgetImpact.totalToolResultTokensAfter,
    )
    expect(out.toolResultBudgetImpact.estimatedTokensSaved).toBeGreaterThanOrEqual(0)
    expect(out.assembledLedger.at(-1)).toMatchObject({
      kind: 'assembled_total',
      tokens: out.totalTokens,
    })
    expect(out.microCompactImpact.compactedBlocks).toBe(1)
    expect(out.microCompactImpact.compactedToolNames).toEqual(['Read'])
    expect(out.microCompactImpact.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.microCompactImpact.keptRecentBlocks).toBe(3)
    expect(out.microCompactImpact.cacheAwareEligibleToolNames).toEqual(['Read', 'Grep', 'Glob', 'WebFetch'])
    expect(out.microCompactImpact.cacheAwareMinResultChars).toBe(500)
    expect(out.microCompactImpact.cacheAwareCompactedBlocks).toBe(0)
    expect(out.microCompactImpact.cacheAwareToolNames).toEqual([])
    expect(out.collapseImpact).toEqual({
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      projectedHistoryTokensAfterCollapse: out.projectedHistoryTokens,
      projectedHistoryDeltaTokens: 0,
      metadata: null,
    })
    expect(out.lifecycleMarkers.map((row) => row.stage)).toEqual([
      'snapshot',
      'post_microcompact',
      'post_prune',
      'post_compact',
    ])
    expect(out.lifecycleMarkers[0]?.deltaFromSnapshot).toBe(0)
    expect(out.fixedTokens).toBeGreaterThan(0)
    expect(out.projectedHistoryTokens).toBeGreaterThan(0)
    expect(out.totalTokens).toBeGreaterThan(out.fixedTokens)
    expect(out.remainingToEffectiveLimit).toBeLessThan(95_000)
    expect(out.topAssembledContributors.length).toBeGreaterThan(0)
    expect(out.topAssembledContributors.some((row) => row.label.includes('Tool result: Read /repo/a.ts'))).toBe(true)
    expect(
      out.topAssembledContributors.some(
        (row) =>
          row.kind === 'tool_result' &&
          row.toolUseId === 'read-1' &&
          row.toolName === 'Read' &&
          row.ordinal === 1,
      ),
    ).toBe(true)
    expect(out.autoCompactSkipReason).toBe('fewer than 2 non-tool user turns (got 0)')
    expect(out.pruneSkipReason).toContain('within effective limit')
  })

  it('reports collapse impact from request-time projection without mutating the underlying history view', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      enableAutoCompact: true,
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [
        buildCompactBoundaryMessage({
          trigger: 'auto',
          preTokens: 4096,
          summaryKind: 'model_summary',
          keepStrategy: {
            kind: 'keep_combo',
            keepLastTurns: 2,
            keepMinTokens: 1200,
            keepMinUserTurns: 1,
          },
        }),
        { role: 'user', content: [{ type: 'text', text: buildCompactionSummaryUserText('Earlier compact summary') }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Older analysis '.repeat(5000) }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'line\n'.repeat(1600) }] as any,
        },
        { role: 'user', content: [{ type: 'text', text: 'Investigate auth redirect regression carefully.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'carry latest working set' }] },
        { role: 'user', content: [{ type: 'text', text: 'Patch redirect without changing unrelated flows.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'latest assistant state' }] },
      ],
      fixedGroups: [],
      budgetConfig: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 12_000,
      },
    })

    expect(out.collapseImpact.collapsed).toBe(true)
    expect(out.collapseImpact.collapsedHeadMessageCount).toBeGreaterThan(0)
    expect(out.collapseImpact.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.collapseImpact.projectedHistoryTokensAfterCollapse).toBeLessThan(out.projectedHistoryTokens)
    expect(out.collapseImpact.projectedHistoryDeltaTokens).toBeLessThan(0)
    expect(out.collapseImpact.metadata).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        retainedCompactSummary: true,
      }),
    )
    expect(out.collapseImpact.metadata?.recapFingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(out.totalTokens).toBeGreaterThan(out.collapseImpact.projectedHistoryTokensAfterCollapse)
    expect(
      out.topAssembledContributors.some(
        (row) =>
          row.kind === 'collapse_recap' &&
          row.key === 'collapse_recap:user:1' &&
          row.role === 'user' &&
          row.ordinal === 1 &&
          row.label.includes('older continuation summary'),
      ),
    ).toBe(true)
    expect(out.topAssembledContributors.some((row) => row.label.includes('Older analysis'))).toBe(false)
  })

  it('uses adaptive microcompact thresholds in next-turn diagnostics for medium Grep results under tighter pressure', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      enableAutoCompact: true,
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'login', path: '/repo/src' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'grep-1', content: 'match\n'.repeat(180) }] as any,
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'grep-2', name: 'Grep', input: { pattern: 'redirect', path: '/repo/src' } }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'grep-2', content: 'match\n'.repeat(180) }] as any,
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Review auth flow and isolate the regression.' }] as any,
        },
      ],
      fixedGroups: [],
      budgetConfig: {
        contextWindowTokens: 300,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 0,
      },
    })

    expect(out.microCompactImpact.compactedBlocks).toBe(1)
    expect(out.microCompactImpact.compactedToolNames).toEqual(['Grep'])
    expect(out.microCompactImpact.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.microCompactImpact.cacheAwareCompactedBlocks).toBeGreaterThanOrEqual(0)
  })

  it('excludes the synthetic compact-boundary marker from post-compact lifecycle history tokens', () => {
    const system = [{ type: 'text', text: 'system instructions' }] as PromptBlock[]
    const messages = [
      buildCompactBoundaryMessage({
        trigger: 'auto',
        preTokens: 88,
        summaryKind: 'model_summary',
        keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 2 },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
        },
        rehydrationCost: {
          sectionCount: 1,
          estimatedTokens: 16,
        },
        preservedSegment: {
          schemaVersion: 1,
          continuationMessageCount: 2,
          preservedTailMessageCount: 1,
          summaryFingerprint: 'summary-fingerprint',
          headFingerprint: 'head-fingerprint',
          tailFingerprint: 'tail-fingerprint',
        },
      }),
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Older compact summary' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Latest user ask' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Latest assistant answer' }],
      },
    ] as PromptMessage[]

    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      system,
      messages,
      fixedGroups: [],
      budgetConfig: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 12_000,
      },
    })

    const postCompact = out.lifecycleMarkers.find((row) => row.stage === 'post_compact')
    expect(postCompact).toBeDefined()

    const keepStrategy = buildAutoCompactKeepStrategy(4)
    const compactionScope = resolveHistoryForCompaction({
      previousHistory: messages,
      allowPartial: true,
    })
    const draft = buildSessionMemoryDraft({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      previousHistory: compactionScope.history,
    })
    const fallbackRehydration = buildPostCompactRehydration({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      previousHistory: compactionScope.history,
    })
    const rehydration = buildSessionMemoryCompactionRehydration({
      draft,
      fallback: fallbackRehydration,
    })
    const rehydrationPlan = markCompactRehydrationApplied(
      draft.currentStrategy.rehydrationPlan ??
        buildDefaultCompactRehydrationPlan({
          mode: 'normal',
          planPath: null,
          hasTodoState: Boolean(rehydration.todoSummary),
        }),
      [
        ...(rehydration.recentFiles.length > 0 ? (['recent_files'] as const) : []),
        ...(rehydration.modeText ? (['mode_state'] as const) : []),
        ...(rehydration.planPath || rehydration.planExcerpt ? (['plan_state'] as const) : []),
        ...(rehydration.todoSummary ? (['todo_state'] as const) : []),
      ],
    )
    const compactedHistory = rebuildHistoryAfterCompaction({
      summary: buildSessionMemoryCompactionSummary(draft).trim() || 'Session memory recap unavailable.',
      previousHistory: compactionScope.history,
      tailSourceHistory: compactionScope.tailSourceHistory,
      keepStrategy,
      rehydration,
      boundaryMeta: {
        trigger: 'auto',
        preTokens: estimatePromptTokens({
          system,
          messages,
        }),
        summaryKind: 'session_memory',
        keepStrategy,
        rehydrationPlan,
        rehydrationCost: estimateCompactRehydrationCost(rehydration),
      },
    })

    const rawCompactedTokens = estimatePromptTokens({ system: [], messages: compactedHistory })
    const continuationTokens = estimatePromptTokens({
      system: [],
      messages: getContinuationMessagesAfterLatestCompactBoundary(compactedHistory),
    })

    expect(compactedHistory.length).toBeGreaterThan(
      getContinuationMessagesAfterLatestCompactBoundary(compactedHistory).length,
    )
    expect(rawCompactedTokens).toBeGreaterThanOrEqual(continuationTokens)
    expect(postCompact?.historyTokens).toBe(continuationTokens)
  })

  it('builds JSON diagnostics output from the same structured payload', () => {
    const raw = buildContextDiagnosticsJson({
      cwd: '/repo',
      cfg: {
        llm: {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-latest',
          apiKey: '',
          baseUrl: '',
          timeoutMs: 60_000,
          thinkingMode: true,
          contextWindowTokens: 100_000,
        },
        context: {
          effectiveContextWindowPercent: 0.95,
          autoCompactTokenLimitPercent: 0.9,
          baselineTokens: 12_000,
          compactKeepLastTurns: 4,
          enableAutoCompact: true,
          autoCompactMinTurnsBetweenRuns: 8,
        },
        paths: {
          logsDir: '',
          subagentsDir: '',
          planDir: '',
        },
        ui: {
          assistantTextMode: 'buffered',
          showContextMeter: true,
          showAutoCompactNotice: true,
          outputStyle: 'default',
          verboseOutput: false,
        },
      } as any,
      allowedSubagents: [],
      mode: 'normal',
      messages: [
        buildCompactBoundaryMessage({
          trigger: 'auto',
          triggerReason: {
            kind: 'auto_threshold',
            detail: 'used=9000 limit=8500',
          },
          preTokens: 88,
          summaryKind: 'model_summary',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 4 },
          rehydrationPlan: {
            schemaVersion: 1,
            items: [
              { kind: 'recent_files', priority: 'high', status: 'planned' },
              { kind: 'mode_state', priority: 'medium', status: 'planned' },
            ],
          },
          rehydrationCost: {
            sectionCount: 2,
            estimatedTokens: 64,
          },
          preservedSegment: {
            schemaVersion: 1,
            continuationMessageCount: 3,
            preservedTailMessageCount: 2,
            summaryFingerprint: 'summary-fingerprint',
            headFingerprint: 'head-fingerprint',
            tailFingerprint: 'tail-fingerprint',
          },
        }),
      ],
      latestRequestCollapse: {
        phase: 'reactive_retry',
        collapsedHeadMessageCount: 4,
        estimatedTokensSaved: 180,
        recapFingerprint: 'feedfacecafebeef',
      },
      latestReactiveCompact: {
        triggerKind: 'maximum_context_length',
        triggerDetail: 'This model exceeded its context window.',
        strategy: 'session_memory',
      },
      nextTurnFixedGroups: [{ label: 'Pending injected blocks', blocks: [{ type: 'text', text: 'saved settings' }] }],
    })

    const parsed = JSON.parse(raw)
    expect(parsed.kind).toBe('formax.context_diagnostics')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.latestCompactBoundary).toMatchObject({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: {
        kind: 'auto_threshold',
        detail: 'used=9000 limit=8500',
      },
      preTokens: 88,
      summaryKind: 'model_summary',
      keepStrategy: {
        kind: 'keep_last_turns',
        keepLastTurns: 4,
      },
      rehydrationPlan: {
        schemaVersion: 1,
        items: [
          { kind: 'recent_files', priority: 'high', status: 'planned' },
          { kind: 'mode_state', priority: 'medium', status: 'planned' },
        ],
      },
      rehydrationCost: {
        sectionCount: 2,
        estimatedTokens: 64,
      },
    })
    expect(parsed.latestRequestCollapse).toEqual({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 180,
      recapFingerprint: 'feedfacecafebeef',
    })
    expect(parsed.latestReactiveCompact).toEqual({
      triggerKind: 'maximum_context_length',
      triggerDetail: 'This model exceeded its context window.',
      strategy: 'session_memory',
    })
    expect(parsed.latestCompactBoundary.preservedSegment).toEqual({
      schemaVersion: 1,
      continuationMessageCount: 3,
      preservedTailMessageCount: 2,
      summaryFingerprint: 'summary-fingerprint',
      headFingerprint: 'head-fingerprint',
      tailFingerprint: 'tail-fingerprint',
    })
    expect(parsed.mode).toBe('normal')
    expect(parsed.snapshot).toBeTruthy()
    expect(parsed.nextTurnFixed).toBeTruthy()
    expect(parsed.snapshot.historyTokens).toBeGreaterThanOrEqual(0)
    expect(parsed.snapshot.systemSectionBreakdown).toBeInstanceOf(Array)
    expect(parsed.snapshot.systemSectionBreakdown[0]).toMatchObject({
      kind: 'system_section',
      key: 'system_section:identity',
      systemSectionKey: 'identity',
    })
    expect(parsed.nextTurnFixed.projectedHistoryTokens).toBeGreaterThanOrEqual(0)
    expect(parsed.nextTurnFixed.lifecycleMarkers).toBeInstanceOf(Array)
    expect(parsed.nextTurnFixed.lifecycleMarkers.map((row: any) => row.stage)).toEqual([
      'snapshot',
      'post_microcompact',
      'post_prune',
      'post_compact',
    ])
    expect(typeof parsed.nextTurnFixed.autoCompactSkipReason).toBe('string')
    expect(parsed.nextTurnFixed.autoCompactSkipReason).toContain('history is empty')
    expect(typeof parsed.nextTurnFixed.pruneSkipReason).toBe('string')
    expect(parsed.nextTurnFixed.pruneSkipReason).toContain('within effective limit')
    expect(parsed.snapshot.topSnapshotContributors[0]).toHaveProperty('kind')
    expect(parsed.snapshot.topSnapshotContributors[0]).toHaveProperty('key')
    expect(parsed.nextTurnFixed.microCompactImpact).toEqual({
      compactedBlocks: 0,
      compactedToolNames: [],
      estimatedTokensSaved: 0,
      keptRecentBlocks: 0,
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 600,
      cacheAwareCompactedBlocks: 0,
      cacheAwareToolNames: [],
    })
    expect(parsed.nextTurnFixed.toolResultBudgetImpact).toMatchObject({
      replacedBlocks: 0,
      replacedToolNames: [],
      estimatedTokensSaved: 0,
      keptRecentBlocks: 0,
      totalToolResultTokensBefore: 0,
      totalToolResultTokensAfter: 0,
    })
    expect(typeof parsed.nextTurnFixed.toolResultBudgetImpact.budgetTokens).toBe('number')
    expect(parsed.nextTurnFixed.collapseImpact).toEqual({
      collapsed: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      projectedHistoryTokensAfterCollapse: parsed.nextTurnFixed.projectedHistoryTokens,
      projectedHistoryDeltaTokens: 0,
      metadata: null,
    })
    expect(parsed.nextTurnFixed.assembledLedger).toBeInstanceOf(Array)
    expect(parsed.nextTurnFixed.assembledLedger[0]).toMatchObject({
      kind: 'system_total',
      key: 'system_total',
    })
    expect(parsed.nextTurnFixed.topAssembledContributors[0]).toHaveProperty('kind')
    expect(parsed.nextTurnFixed.topAssembledContributors[0]).toHaveProperty('key')
    expect(parsed.notes).toBeInstanceOf(Array)
  })

  it('parses supported /context output formats', () => {
    expect(resolveContextDiagnosticsOutputFormat('')).toBe('text')
    expect(resolveContextDiagnosticsOutputFormat('   ')).toBe('text')
    expect(resolveContextDiagnosticsOutputFormat('--json')).toBe('json')
    expect(resolveContextDiagnosticsOutputFormat(' --json ')).toBe('json')
    expect(resolveContextDiagnosticsOutputFormat('--yaml')).toBe(null)
  })

  it('formats latest compact rehydration plan in the text report', () => {
    const diagnostics = analyzeContextDiagnostics({
      system: [{ type: 'text', text: 'system instructions' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      budgetConfig: null,
    })

    const out = formatContextDiagnosticsReport({
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'manual',
        preTokens: 123,
        summaryKind: 'model_summary',
        keepStrategy: { kind: 'keep_combo', keepLastTurns: 2, keepMinTokens: 1200, keepMinUserTurns: 1 },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [
            { kind: 'recent_files', priority: 'high', status: 'planned' },
            { kind: 'plan_state', priority: 'high', status: 'planned' },
          ],
        },
        rehydrationCost: {
          sectionCount: 2,
          estimatedTokens: 48,
        },
        preservedSegment: {
          schemaVersion: 1,
          continuationMessageCount: 3,
          preservedTailMessageCount: 2,
          summaryFingerprint: 'summary-abc',
          headFingerprint: 'head-abc',
          tailFingerprint: 'tail-abc',
        },
      },
      diagnostics,
      mode: 'plan',
      model: 'claude-3-5-sonnet-latest',
    })

    expect(out).toContain('- Rehydration plan: recent_files(high/planned), plan_state(high/planned)')
    expect(out).toContain('- Rehydration cost: 2 sections / 48 tokens')
    expect(out).toContain('- Preserved segment: continuation=3, preserved_tail=2, head=head-abc, tail=tail-abc')
    expect(out).toContain('- Keep strategy: keep_combo(turns=2, min_tokens=1,200, min_user_turns=1)')
  })

  it('includes working-set signals in next-turn diagnostics', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'inspect auth.ts' }] as any },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }] as any,
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'ok' }] as any },
        { role: 'assistant', content: [{ type: 'text', text: 'auth flow has stale redirect guard' }] as any },
      ],
      fixedGroups: [],
      keepLastTurns: 2,
      enableAutoCompact: true,
      budgetConfig: {
        contextWindowTokens: 10_000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.7,
        baselineTokens: 0,
      },
    })

    expect(out.workingSetSignals).toEqual({
      recentFileCount: 1,
      hasPlanState: true,
      hasTodoState: false,
      modeState: 'plan',
      keepMinTokensBoost: 600,
      keepMinUserTurnsBoost: 1,
      anchorKind: 'read',
      anchorToolNames: ['Read'],
      anchorBacktrackTurns: 0,
    })
  })

  it('reports filesystem-cluster working-set anchor details in next-turn diagnostics', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'normal',
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'grep auth routes' }] as any },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'redirect', path: '/repo/src' } }] as any,
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'grep-1', content: 'ok' }] as any },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'glob-1', name: 'Glob', input: { pattern: '**/*auth*', path: '/repo/src' } }] as any,
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'glob-1', content: 'ok' }] as any },
        { role: 'assistant', content: [{ type: 'text', text: 'found auth route files' }] as any },
        { role: 'user', content: [{ type: 'text', text: 'rename the CTA' }] as any },
        { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(2400) }] as any },
      ],
      fixedGroups: [],
      keepLastTurns: 1,
      enableAutoCompact: true,
      budgetConfig: {
        contextWindowTokens: 10_000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.7,
        baselineTokens: 0,
      },
    })

    expect(out.workingSetSignals.anchorKind).toBe('filesystem_cluster')
    expect(out.workingSetSignals.anchorToolNames).toEqual(['Glob', 'Grep'])
    expect(out.workingSetSignals.anchorBacktrackTurns).toBe(1)
  })

  it('does not overstate anchor backtrack when keepMinUserTurns boost already expands the baseline', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'inspect auth.ts' }] as any },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }] as any,
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'ok' }] as any },
        { role: 'assistant', content: [{ type: 'text', text: 'found redirect guard' }] as any },
        { role: 'user', content: [{ type: 'text', text: 'rename CTA copy' }] as any },
        { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(2400) }] as any },
      ],
      fixedGroups: [],
      keepLastTurns: 1,
      enableAutoCompact: true,
      budgetConfig: {
        contextWindowTokens: 10_000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.7,
        baselineTokens: 0,
      },
    })

    expect(out.workingSetSignals.keepMinUserTurnsBoost).toBe(1)
    expect(out.workingSetSignals.anchorBacktrackTurns).toBe(0)
  })
})

describe('autoCompactSkipReason and pruneSkipReason', () => {
  const system: PromptBlock[] = [{ type: 'text', text: 'sys' }]

  function userMsg(text: string): PromptMessage {
    return { role: 'user', content: [{ type: 'text', text }] as any }
  }

  function assistantMsg(): PromptMessage {
    return { role: 'assistant', content: [{ type: 'text', text: 'ok' }] as any }
  }

  const twoTurnMessages: PromptMessage[] = [
    userMsg('turn 1'), assistantMsg(),
    userMsg('turn 2'), assistantMsg(),
  ]

  const budget = {
    contextWindowTokens: 10_000,
    effectiveContextWindowPercent: 0.9,
    autoCompactLimitPercent: 0.7,
    baselineTokens: 0,
  }

  it('returns skip reason when enableAutoCompact is false', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], enableAutoCompact: false, budgetConfig: budget,
    })
    expect(out.autoCompactSkipReason).toMatch(/disabled/)
  })

  it('returns skip reason when budgetConfig is null', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], enableAutoCompact: true, budgetConfig: null,
    })
    expect(out.autoCompactSkipReason).toMatch(/contextWindowTokens unknown/)
  })

  it('returns skip reason when history has fewer than 2 non-tool user turns', () => {
    const oneUserTurn: PromptMessage[] = [userMsg('only one')]
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: oneUserTurn,
      fixedGroups: [], enableAutoCompact: true, budgetConfig: budget,
    })
    expect(out.autoCompactSkipReason).toMatch(/fewer than 2/)
  })

  it('returns below-threshold skip reason when tokens are well under the auto-compact limit', () => {
    // With contextWindow=10000, autoCompactLimit=70% → 7000. twoTurnMessages tokens are tiny.
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], enableAutoCompact: true, budgetConfig: budget,
    })
    expect(out.autoCompactSkipReason).toMatch(/below threshold/)
  })

  it('returns null autoCompactSkipReason when all conditions pass', () => {
    const largeMessages: PromptMessage[] = [
      userMsg('turn 1'),
      { role: 'assistant', content: [{ type: 'text', text: 'A'.repeat(25_000) }] as any },
      userMsg('turn 2'),
      { role: 'assistant', content: [{ type: 'text', text: 'B'.repeat(25_000) }] as any },
    ]
    // Pre-prune assembled total is above the auto-compact threshold, but prune pulls the final
    // assembled view back down. Diagnostics should still report that visible auto-compact
    // preconditions are met, because runtime checks the threshold before prune.
    const tinyBudget = {
      contextWindowTokens: 10_000,
      effectiveContextWindowPercent: 0.95,
      autoCompactLimitPercent: 0.9,
      baselineTokens: 1_000,
    }
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: largeMessages,
      fixedGroups: [], enableAutoCompact: true, budgetConfig: tinyBudget,
    })
    expect(out.autoCompactSkipReason).toBeNull()
    expect(out.shouldAutoCompact).toBe(false)
  })

  it('pruneSkipReason is non-null (tokens within limit) under normal budget', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], budgetConfig: budget,
    })
    expect(out.pruneSkipReason).toMatch(/within effective limit/)
  })

  it('pruneSkipReason is null when tokens exceed effective limit', () => {
    const largeMessages: PromptMessage[] = [
      userMsg('turn 1'),
      { role: 'assistant', content: [{ type: 'text', text: 'A'.repeat(25_000) }] as any },
      userMsg('turn 2'),
      { role: 'assistant', content: [{ type: 'text', text: 'B'.repeat(25_000) }] as any },
    ]
    const tinyBudget = {
      contextWindowTokens: 10_000,
      effectiveContextWindowPercent: 0.95,
      autoCompactLimitPercent: 0.9,
      baselineTokens: 1_000,
    }
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: largeMessages,
      fixedGroups: [], budgetConfig: tinyBudget,
    })
    expect(out.pruneSkipReason).toBeNull()
  })

  it('pruneSkipReason is non-null string when budgetConfig is null', () => {
    const out = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], budgetConfig: null,
    })
    expect(out.pruneSkipReason).toMatch(/contextWindowTokens unknown/)
  })

  it('text report contains trigger reason kind and detail lines', () => {
    const report = formatContextDiagnosticsReport({
      latestCompactBoundary: {
        schemaVersion: 1,
        trigger: 'auto',
        triggerReason: { kind: 'auto_threshold', detail: 'used=5000 limit=4000' },
      },
      diagnostics: analyzeContextDiagnostics({ system, messages: [] }),
      mode: 'normal',
      model: 'test-model',
    })
    expect(report).toContain('- Trigger reason kind: auto_threshold')
    expect(report).toContain('- Trigger reason detail: used=5000 limit=4000')
  })

  it('text report shows "none" for trigger reason when no compact boundary', () => {
    const report = formatContextDiagnosticsReport({
      latestCompactBoundary: null,
      diagnostics: analyzeContextDiagnostics({ system, messages: [] }),
      mode: 'normal',
      model: 'test-model',
    })
    expect(report).toContain('- Trigger reason kind: none')
    expect(report).toContain('- Trigger reason detail: none')
  })

  it('text report contains auto-compact skip reason and prune skip reason lines', () => {
    const nextTurnData = analyzeNextTurnFixedContext({
      cwd: '/repo', mode: 'normal', system, messages: twoTurnMessages,
      fixedGroups: [], enableAutoCompact: false, budgetConfig: budget,
    })
    const report = formatContextDiagnosticsReport({
      diagnostics: analyzeContextDiagnostics({ system, messages: twoTurnMessages }),
      nextTurn: nextTurnData,
      mode: 'normal',
      model: 'test-model',
    })
    expect(report).toContain('- Auto-compact skip reason:')
    expect(report).toContain('disabled')
    expect(report).toContain('- Prune skip reason:')
    expect(report).toContain('within effective limit')
  })

  it('text report contains latest request collapse summary when present', () => {
    const report = formatContextDiagnosticsReport({
      latestRequestCollapse: {
        phase: 'initial',
        collapsedHeadMessageCount: 5,
        estimatedTokensSaved: 210,
        recapFingerprint: 'abcdeffedcba1234',
      },
      diagnostics: analyzeContextDiagnostics({ system, messages: [] }),
      mode: 'normal',
      model: 'test-model',
    })
    expect(report).toContain('Latest request collapse')
    expect(report).toContain('- Phase: initial')
    expect(report).toContain('- Collapsed older messages: 5')
    expect(report).toContain('- Estimated tokens saved: 210')
    expect(report).toContain('- Recap fingerprint: abcdeffedcba1234')
  })

  it('text report contains latest reactive compact summary when present', () => {
    const out = formatContextDiagnosticsReport({
      latestReactiveCompact: {
        triggerKind: 'maximum_context_length',
        triggerDetail: 'context window exceeded',
        strategy: 'model_summary',
      },
      diagnostics: analyzeContextDiagnostics({ system, messages: [] }),
      mode: 'normal',
      model: 'test-model',
    })

    expect(out).toContain('Latest reactive compact')
    expect(out).toContain('- Trigger kind: maximum_context_length')
    expect(out).toContain('- Trigger detail: context window exceeded')
    expect(out).toContain('- Fallback strategy: model_summary')
  })
})
