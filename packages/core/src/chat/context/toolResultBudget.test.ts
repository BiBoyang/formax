import { describe, expect, it } from 'vitest'
import { applyToolResultBudget, resolveAdaptiveToolResultBudgetPolicy } from './toolResultBudget'
import { buildContextProjection, fingerprintToolResultContent } from './contextProjection'

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): any {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
  }
}

function userToolResult(id: string, content: string): any {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }],
  }
}

describe('toolResultBudget', () => {
  it('replaces older eligible tool results when the tool-result group exceeds budget', () => {
    const policy = resolveAdaptiveToolResultBudgetPolicy({
      pressureRatio: 0.92,
      budgetConfig: {
        contextWindowTokens: 10000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.85,
        baselineTokens: 1000,
      },
    })
    const messages = [
      assistantToolUse('read-old', 'Read', { file_path: '/repo/old.ts' }),
      userToolResult('read-old', 'a'.repeat(5000)),
      assistantToolUse('read-recent', 'Read', { file_path: '/repo/recent.ts' }),
      userToolResult('read-recent', 'b'.repeat(5000)),
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy,
    })

    expect(out.applied).toBe(true)
    expect(out.impact.replacedBlocks).toBe(1)
    expect(out.impact.replacedToolNames).toEqual(['Read'])
    expect(out.impact.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.impact.totalToolResultTokensAfter).toBeLessThan(out.impact.totalToolResultTokensBefore)
    expect((out.messages[1]!.content[0] as any).content).toContain('[Tool result replaced by budget: Read /repo/old.ts')
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(5000))
  })

  it('keeps request history unchanged when the tool-result group is already within budget', () => {
    const policy = resolveAdaptiveToolResultBudgetPolicy({
      pressureRatio: 0.4,
      budgetConfig: {
        contextWindowTokens: 10000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.85,
        baselineTokens: 1000,
      },
    })
    const messages = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/a.ts' }),
      userToolResult('read-1', 'short result'),
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy,
    })

    expect(out.applied).toBe(false)
    expect(out.impact.replacedBlocks).toBe(0)
    expect(out.messages).toEqual(messages)
  })

  it('continues to later candidates when an earlier replacement would save no tokens', () => {
    const messages = [
      assistantToolUse('read-short', 'Read', { file_path: '/repo/short.ts' }),
      userToolResult('read-short', 'x'),
      assistantToolUse('read-large', 'Read', { file_path: '/repo/large.ts' }),
      userToolResult('read-large', 'line\n'.repeat(1200)),
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy: {
        pressureTier: 'critical',
        eligibleToolNames: ['Read'],
        keepRecentToolResults: 0,
        minResultChars: 1,
        minResultCharsByName: {},
        maxToolResultTokens: 1,
      },
    })

    expect(out.applied).toBe(true)
    expect(out.impact.replacedBlocks).toBe(1)
    expect(out.impact.replacedToolNames).toEqual(['Read'])
    expect((out.messages[1]!.content[0] as any).content).toBe('x')
    expect((out.messages[3]!.content[0] as any).content).toContain('[Tool result replaced by budget: Read /repo/large.ts')
  })

  it('does not re-stub durable tool-result content replacements', () => {
    const messages = [
      assistantToolUse('read-durable', 'Read', { file_path: '/repo/durable.ts' }),
      {
        ...userToolResult('read-durable', '[durable replacement] '.repeat(500)),
        meta: {
          durableToolResultContentReplacementToolUseIds: ['read-durable'],
        },
      },
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy: {
        pressureTier: 'critical',
        eligibleToolNames: ['Read'],
        keepRecentToolResults: 0,
        minResultChars: 1,
        minResultCharsByName: {},
        maxToolResultTokens: 1,
      },
    })

    expect(out.applied).toBe(false)
    expect(out.impact.replacedBlocks).toBe(0)
    expect((out.messages[1]!.content[0] as any).content).toContain('[durable replacement]')
  })

  it('only honors durable replacement markers for the same tool_use_id', () => {
    const messages = [
      assistantToolUse('read-old', 'Read', { file_path: '/repo/old.ts' }),
      {
        ...userToolResult('read-old', 'a'.repeat(5000)),
        meta: {
          durableToolResultContentReplacementToolUseIds: ['other-tool'],
        },
      },
      assistantToolUse('read-recent', 'Read', { file_path: '/repo/recent.ts' }),
      userToolResult('read-recent', 'b'.repeat(5000)),
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy: {
        pressureTier: 'critical',
        eligibleToolNames: ['Read'],
        keepRecentToolResults: 1,
        minResultChars: 1,
        minResultCharsByName: {},
        maxToolResultTokens: 1,
      },
    })

    expect(out.applied).toBe(true)
    expect(out.impact.replacedBlocks).toBe(1)
    expect((out.messages[1]!.content[0] as any).content).toContain('[Tool result replaced by budget: Read /repo/old.ts')
  })

  it('does not mutate input messages in-place when applying replacements', () => {
    const messages = [
      assistantToolUse('read-old', 'Read', { file_path: '/repo/old.ts' }),
      userToolResult('read-old', 'a'.repeat(5000)),
      assistantToolUse('read-recent', 'Read', { file_path: '/repo/recent.ts' }),
      userToolResult('read-recent', 'b'.repeat(5000)),
    ] as any

    const out = applyToolResultBudget({
      messages,
      policy: {
        pressureTier: 'critical',
        eligibleToolNames: ['Read'],
        keepRecentToolResults: 1,
        minResultChars: 1,
        minResultCharsByName: {},
        maxToolResultTokens: 1,
      },
    })

    expect(out.applied).toBe(true)
    expect(out.messages).not.toBe(messages)
    expect(out.messages[1]).not.toBe(messages[1])
    expect((messages[1]!.content[0] as any).content).toBe('a'.repeat(5000))
    expect((out.messages[1]!.content[0] as any).content).toContain('[Tool result replaced by budget: Read /repo/old.ts')
    expect(out.messages[3]).toBe(messages[3])
    expect((messages[3]!.content[0] as any).content).toBe('b'.repeat(5000))
  })

  it('keeps drift-skipped durable replacement results eligible for request-time budget', () => {
    const originalContent = 'a'.repeat(5000)
    const history = [
      assistantToolUse('read-old', 'Read', { file_path: '/repo/old.ts' }),
      userToolResult('read-old', originalContent),
    ] as any
    const projection = buildContextProjection({
      history,
      durableState: {
        toolResultContentReplacement: {
          schemaVersion: 1,
          sourceScope: { kind: 'main_thread' },
          replacements: [
            {
              kind: 'tool_result_block',
              toolUseId: 'read-old',
              replacementContent: '[drifted durable replacement]',
              originalContentFingerprint: fingerprintToolResultContent('old content before drift'),
            },
          ],
        },
      },
    })

    const out = applyToolResultBudget({
      messages: projection.modelFacingBaseline,
      policy: {
        pressureTier: 'critical',
        eligibleToolNames: ['Read'],
        keepRecentToolResults: 0,
        minResultChars: 1,
        minResultCharsByName: {},
        maxToolResultTokens: 1,
      },
    })

    expect(projection.durableState.toolResultContentReplacement).toMatchObject({
      applied: false,
      replacementCount: 0,
      skippedReplacementCount: 1,
    })
    expect(out.applied).toBe(true)
    expect((out.messages[1]!.content[0] as any).content).toContain('[Tool result replaced by budget: Read /repo/old.ts')
  })
})
