import { describe, expect, it } from 'vitest'
import { estimatePromptTokens } from './estimate'
import { buildCompactBoundaryMessage } from './compact'

describe('estimatePromptTokens', () => {
  it('returns a stable, non-negative estimate', () => {
    const a = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })
    const b = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })

    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBe(b)
  })

  it('uses only the latest compact-boundary continuation view', () => {
    const estimate = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
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
    })

    const expected = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'summary-2' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'tail-2' }] },
      ],
    })

    expect(estimate).toBe(expected)
  })
})
