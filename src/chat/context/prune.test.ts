import { describe, expect, it } from 'vitest'
import { pruneForPromptBudget } from './prune'
import { estimatePromptTokens } from './estimate'

describe('pruneForPromptBudget', () => {
  it('truncates long tool_result content first', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50_000) }],
      },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'ok' }] },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages,
      contextWindowTokens: 10_000,
    })

    expect(out.pruned).toBe(true)
    const tr = out.messages[1] as any
    expect(tr?.role).toBe('user')
    expect(String(tr?.content?.[0]?.content || '')).toContain('[truncated]')
  })

  it('never returns a history starting with tool_result', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50_000) }],
      },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'later' }] },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages,
      contextWindowTokens: 1_000,
    })

    const first = out.messages[0] as any
    expect(first?.role).not.toBe('user')
    expect(first?.content?.some?.((b: any) => b?.type === 'tool_result')).toBe(false)
  })

  it('returns empty messages when only tool_result exists', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50_000) }],
      },
    ]

    const out = pruneForPromptBudget({ system: [], messages, contextWindowTokens: 1_000 })
    expect(out.messages.length).toBe(0)
  })

  it('forces an oversized single user message to fit', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'text', text: 'x'.repeat(200_000) }],
      },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages,
      contextWindowTokens: 2_000,
      effectiveContextWindowPercent: 1,
    })

    const estimate = estimatePromptTokens({ system: [], messages: out.messages })
    expect(estimate).toBeLessThanOrEqual(2_000)
  })
})
