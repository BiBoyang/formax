import { describe, expect, it } from 'vitest'
import {
  analyzeContextDiagnostics,
  analyzeNextTurnFixedContext,
  buildContextDiagnosticsJson,
  formatContextDiagnosticsReport,
  resolveContextDiagnosticsOutputFormat,
} from './contextDiagnostics'
import type { PromptBlock, PromptMessage } from '../../prompts'
import { buildCompactBoundaryMessage } from './compact'

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
      label: 'System section: Identity',
      tokens: out.systemTokens,
    })
    expect(out.topSnapshotContributors.length).toBeGreaterThan(0)
    expect(out.topSnapshotContributors.some((row) => row.label === 'System section: Identity')).toBe(true)
    expect(out.topSnapshotContributors.some((row) => row.label.includes('Tool result: Read /repo/a.ts'))).toBe(true)
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
    expect(out).toContain('- Projected history before microcompact/prune: 22')
    expect(out).toContain('- Projected history after microcompact/prune: unknown')
    expect(out).toContain('- Estimated tokens saved by microcompact: 0')
    expect(out).toContain('- Microcompact compacted blocks: 0')
    expect(out).toContain('- Microcompact compacted tools: none')
    expect(out).toContain('- Fixed group breakdown: none')
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
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 0.95,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 12_000,
      },
    })

    expect(out.fixedGroups.map((row) => row.label)).toEqual(['Mode semantic blocks', 'Pending injected blocks'])
    expect(out.microCompactImpact.compactedBlocks).toBe(1)
    expect(out.microCompactImpact.compactedToolNames).toEqual(['Read'])
    expect(out.microCompactImpact.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.microCompactImpact.keptRecentBlocks).toBe(3)
    expect(out.fixedTokens).toBeGreaterThan(0)
    expect(out.projectedHistoryTokens).toBeGreaterThan(0)
    expect(out.totalTokens).toBeGreaterThan(out.fixedTokens)
    expect(out.remainingToEffectiveLimit).toBeLessThan(95_000)
    expect(out.topAssembledContributors.length).toBeGreaterThan(0)
    expect(out.topAssembledContributors.some((row) => row.label.includes('Tool result: Read /repo/a.ts'))).toBe(true)
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
      nextTurnFixedGroups: [{ label: 'Pending injected blocks', blocks: [{ type: 'text', text: 'saved settings' }] }],
    })

    const parsed = JSON.parse(raw)
    expect(parsed.kind).toBe('formax.context_diagnostics')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.latestCompactBoundary).toMatchObject({
      schemaVersion: 1,
      trigger: 'auto',
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
    expect(parsed.nextTurnFixed.projectedHistoryTokens).toBeGreaterThanOrEqual(0)
    expect(parsed.nextTurnFixed.microCompactImpact).toEqual({
      compactedBlocks: 0,
      compactedToolNames: [],
      estimatedTokensSaved: 0,
      keptRecentBlocks: 0,
    })
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
})
