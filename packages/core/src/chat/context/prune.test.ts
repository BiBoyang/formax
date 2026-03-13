import { describe, expect, it } from 'vitest'
import { pruneForPromptBudget } from './prune'
import { computeContextBudget } from './budget'
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

function expectFitsBudget(args: {
  system: any[]
  messages: any[]
  contextWindowTokens: number
  effectiveContextWindowPercent?: number
  autoCompactLimitPercent?: number
}): void {
  const budget = computeContextBudget({
    contextWindowTokens: args.contextWindowTokens,
    effectiveContextWindowPercent: args.effectiveContextWindowPercent,
    autoCompactLimitPercent: args.autoCompactLimitPercent,
  })
  const estimate = estimatePromptTokens({ system: args.system, messages: args.messages })
  expect(estimate).toBeLessThanOrEqual(budget.effectiveLimitTokens)
}

describe('pruneForPromptBudget', () => {
  it('returns early without pruning when already within budget', () => {
    const messages = [{ role: 'user' as const, content: [{ type: 'text', text: 'hello' }] }]
    const out = pruneForPromptBudget({ system: [], messages, contextWindowTokens: 100_000 })
    expect(out).toEqual({ messages, pruned: false })
  })

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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 10_000 })
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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 2_000, effectiveContextWindowPercent: 1 })
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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 1_000 })
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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 1_000 })
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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 800, effectiveContextWindowPercent: 1 })
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
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 2_000, effectiveContextWindowPercent: 1 })
  })

  it('keeps tool_use/tool_result pairs and fits budget with multiple tool outputs', () => {
    const big = 'x'.repeat(100_000)
    const messages = [
      { role: 'user' as const, content: [{ type: 'text', text: 'start' }] },
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
      },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 't1', content: big }] },
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/x' } }],
      },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 't2', content: big }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'done' }] },
    ]

    const out = pruneForPromptBudget({ system: [], messages, contextWindowTokens: 1_000, effectiveContextWindowPercent: 1 })
    expectNoOrphanTools(out.messages as any)
    expectFitsBudget({ system: [], messages: out.messages as any, contextWindowTokens: 1_000, effectiveContextWindowPercent: 1 })
  })

  it('handles malformed/sparse messages and mixed block kinds while forcing fallback', () => {
    const sparse: any[] = new Array(3)
    sparse[0] = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(20_000) }],
    }
    sparse[1] = {
      role: 'system',
      content: [
        null,
        { type: 'thinking', thinking: 'think' },
        { type: 'tool_use', id: 'u1', name: 'Read' },
        { type: 'tool_result', content: { nested: true } },
        { type: 'unknown_kind', foo: 'bar' },
      ],
    }
    // index 2 intentionally left empty to exercise sparse-array branch paths.

    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(30_000) } as any],
      messages: sparse as any,
      contextWindowTokens: 600,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(Array.isArray(out.messages)).toBe(true)
  })

  it('truncates non-tagged and unclosed-tag ephemeral text variants', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'plain '.repeat(5000), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: '<scratchpad>\n' + 'x'.repeat(20_000), cache_control: { type: 'ephemeral' } },
        ],
      },
    ]

    const out = pruneForPromptBudget({
      system: [],
      messages: messages as any,
      contextWindowTokens: 1_000,
      effectiveContextWindowPercent: 1,
    })

    const first = out.messages[0] as any
    const texts = (first?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || ''))
    expect(texts.some((t: string) => t.includes('[truncated]'))).toBe(true)
  })

  it('returns empty when system alone exceeds budget and messages are empty', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(80_000) } as any],
      messages: [],
      contextWindowTokens: 400,
      effectiveContextWindowPercent: 1,
    })
    expect(out).toEqual({ messages: [], pruned: true })
  })

  it('keeps non-user/assistant message in essential tail reduction path', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(50_000) } as any],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] } as any,
        { role: 'system', content: [{ type: 'text', text: 'side-channel' }] } as any,
      ],
      contextWindowTokens: 300,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(Array.isArray(out.messages)).toBe(true)
  })

  it('force-fit fallback scans non-tool-result tail and squashes mixed blocks', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(60_000) } as any],
      messages: [
        {
          role: 'user',
          content: [],
        } as any,
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'x'.repeat(20_000) }],
        } as any,
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal reasoning' },
            { type: 'tool_result', content: { nested: true } },
            { type: 'tool_use', id: 'u1', name: 'Read' },
            { type: 'unknown_kind', value: 1 },
          ],
        } as any,
      ],
      contextWindowTokens: 280,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(out.messages.length).toBeGreaterThan(0)
    const flattened = JSON.stringify(out.messages)
    expect(flattened).toContain('internal reasoning')
    expect(flattened).not.toContain('[object Object]')
    expect(flattened).toContain('unknown_kind')
  })

  it('squash fallback includes tool_use marker when target contains tool_use blocks', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(70_000) } as any],
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'x'.repeat(30_000) }],
        } as any,
        {
          role: 'system',
          content: [{ type: 'tool_use', id: 'x1', name: 'Read' }],
        } as any,
      ],
      contextWindowTokens: 260,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(JSON.stringify(out.messages)).toContain('[tool_use Read]')
  })

  it('keeps short non-string hot content unchanged while still pruning oversized prompt', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(90_000) } as any],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'k1' },
            { type: 'text', cache_control: { type: 'ephemeral' } },
          ],
        } as any,
      ],
      contextWindowTokens: 300,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(Array.isArray(out.messages)).toBe(true)
  })

  it('drops orphan tool_use and non-tool user blocks during normalization + essential reduction', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(60_000) } as any],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'anchor' }] } as any,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'orphan', name: 'Read' }] } as any,
        { role: 'user', content: [{ type: 'text', text: 'drop-this' }] } as any,
      ],
      contextWindowTokens: 260,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    expect(Array.isArray(out.messages)).toBe(true)
  })

  it('force-fit tagged fallback appends truncation marker for unclosed tags', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(100_000) } as any],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '<scratchpad>\n' + 'x'.repeat(40_000) }],
        } as any,
      ],
      contextWindowTokens: 220,
      effectiveContextWindowPercent: 1,
    })

    const rendered = JSON.stringify(out.messages)
    expect(out.pruned).toBe(true)
    expect(rendered).toContain('[truncated]')
  })

  it('keeps already-closed tags in clipped prefix without appending extra close marker', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(110_000) } as any],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '<tag>ok</tag>' + 'x'.repeat(30_000) }],
        } as any,
      ],
      contextWindowTokens: 220,
      effectiveContextWindowPercent: 1,
    })

    const rendered = JSON.stringify(out.messages)
    expect(out.pruned).toBe(true)
    expect(rendered).toContain('<tag>ok</tag>')
  })

  it('force-fit scan skips trailing tool_result then squashes mixed/primitive system blocks', () => {
    const out = pruneForPromptBudget({
      system: [{ type: 'text', text: 'S'.repeat(120_000) } as any],
      messages: [
        { role: 'user', content: [] } as any,
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read' }] } as any,
        {
          role: 'system',
          content: [
            { type: 'tool_use', id: 't1' },
            { type: 'text', text: '<tag>ok</tag>' },
            { type: 'text' },
            { type: 'thinking' },
            { type: 'tool_result' },
            null,
            123,
            { type: 'text', text: 'x'.repeat(20_000) },
          ],
        } as any,
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] } as any,
      ],
      contextWindowTokens: 240,
      effectiveContextWindowPercent: 1,
    })

    expect(out.pruned).toBe(true)
    const rendered = JSON.stringify(out.messages)
    expect(rendered).toContain('[tool_use ]')
    expect(rendered).toContain('[truncated]')
  })
})
