import { describe, expect, it } from 'vitest'
import { analyzeContextDiagnostics, formatContextDiagnosticsReport } from './contextDiagnostics'
import type { PromptBlock, PromptMessage } from '../../prompts'

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
    expect(out.totalTokens).toBeGreaterThan(0)
    expect(out.systemTokens).toBeGreaterThan(0)
    expect(out.historyTokens).toBeGreaterThan(0)
    expect(out.toolResultTokens).toBeGreaterThan(0)
    expect(out.otherHistoryTokens).toBeGreaterThan(0)
    expect(out.remainingToEffectiveLimit).toBeLessThan(95_000)
    expect(out.shouldAutoCompact).toBe(false)
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
    expect(out).toContain('- Snapshot: current persisted prompt history only')
    expect(out).toContain('- Mode: plan')
    expect(out).toContain('- Model: claude-3-5-sonnet-latest')
    expect(out).toContain('- Context window: unknown')
    expect(out).toContain('- Tool result blocks: 0')
    expect(out).toContain('Notes')
  })
})
