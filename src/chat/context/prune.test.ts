import { describe, expect, it } from 'vitest'
import { pruneForPromptBudget } from './prune'
import { estimatePromptTokens } from './estimate'

function extractToolPairs(messages: any[]): { toolUseIds: Set<string>; toolResultIds: Set<string> } {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue
    if (msg.role === 'assistant') {
      for (const b of msg.content) {
        if (b?.type === 'tool_use' && typeof b.id === 'string') toolUseIds.add(b.id)
      }
    }
    if (msg.role === 'user') {
      for (const b of msg.content) {
        if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') toolResultIds.add(b.tool_use_id)
      }
    }
  }

  return { toolUseIds, toolResultIds }
}

function expectNoOrphanTools(messages: any[]): void {
  const { toolUseIds, toolResultIds } = extractToolPairs(messages)
  expect(Array.from(toolUseIds).sort()).toEqual(Array.from(toolResultIds).sort())
}

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

  it('never emits orphan tool_use/tool_result pairs when trimming', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50_000) }],
      },
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/y' } }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'y'.repeat(50_000) }],
      },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'later' }] },
    ]

    const out = pruneForPromptBudget({ system: [], messages, contextWindowTokens: 1_000 })
    expectNoOrphanTools(out.messages as any)
  })

  it('truncates oversized ephemeral injected blocks', () => {
    const big = '<system-reminder>\n' + 'x'.repeat(50_000) + '\n</system-reminder>'
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: big, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'hello' },
        ],
      },
    ]

    const out = pruneForPromptBudget({ system: [], messages, contextWindowTokens: 1_000 })
    const first = out.messages[0] as any
    const injected = first?.content?.[0]?.text as string
    expect(injected).toContain('[truncated]')
    expect(injected).toContain('</system-reminder>')
  })

  it('keeps the last non-tool user message under tight budgets', () => {
    const messages = [
      { role: 'user' as const, content: [{ type: 'text', text: 'user question' }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'x'.repeat(50_000) }] },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages,
      contextWindowTokens: 800,
      effectiveContextWindowPercent: 1,
    })

    expect(out.messages.length).toBeGreaterThan(0)
    expect(out.messages[0]?.role).toBe('user')
    const firstText = (out.messages[0] as any)?.content?.[0]?.text as string
    expect(firstText).toContain('user question')
  })

  it('keeps paired tool blocks while dropping non-tool assistant text in minimal fallback', () => {
    const huge = 'A'.repeat(50_000)
    const messages = [
      { role: 'user' as const, content: [{ type: 'text', text: 'question' }] },
      {
        role: 'assistant' as const,
        content: [
          { type: 'text', text: 'planning...' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } },
        ],
      },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: huge }] },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages,
      contextWindowTokens: 2_000,
      effectiveContextWindowPercent: 1,
    })

    expectNoOrphanTools(out.messages as any)

    const combined = JSON.stringify(out.messages)
    expect(combined).not.toContain(huge.slice(0, 1000))
  })
})
