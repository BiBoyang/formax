import { describe, it, expect } from 'vitest'
import type { PromptMessage } from '../../prompts'
import {
  buildDefaultCompactRehydrationPlan,
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  isCompactBoundaryMessage,
  isCompactionSummaryUserMessage,
  rebuildHistoryAfterCompaction,
  selectTailForCompaction,
  stripCompactBoundaryMessages,
} from './compact'

function txt(role: PromptMessage['role'], text: string): PromptMessage {
  return { role, content: [{ type: 'text', text }] as any }
}

function toolUse(id: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/a' } }] as any,
  }
}

function toolResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] as any,
  }
}

describe('selectTailForCompaction', () => {
  it('selects the last N user turns and keeps tool pairs within the tail', () => {
    const history: PromptMessage[] = [
      txt('user', 'u1'),
      toolUse('t1'),
      toolResult('t1'),
      txt('assistant', 'a1'),
      txt('user', 'u2'),
      txt('assistant', 'a2'),
    ]

    const tail = selectTailForCompaction(history, 1)
    expect(tail.map((m) => (m.content as any[])[0]?.text ?? (m.content as any[])[0]?.type)).toEqual([
      'u2',
      'a2',
    ])
  })

  it('returns empty for keepLastTurns <= 0', () => {
    const history: PromptMessage[] = [txt('user', 'u1'), txt('assistant', 'a1')]
    expect(selectTailForCompaction(history, 0)).toEqual([])
    expect(selectTailForCompaction(history, -1)).toEqual([])
  })

  it('returns empty when no non-tool user turns exist and tolerates sparse arrays', () => {
    const sparse = [] as PromptMessage[]
    sparse[1] = txt('assistant', 'a1')
    sparse[2] = toolResult('t1')
    expect(selectTailForCompaction(sparse, 2)).toEqual([])
  })

  it('handles non-finite keep and keep values larger than user turn count', () => {
    const history: PromptMessage[] = [txt('user', 'u1'), txt('assistant', 'a1'), txt('user', 'u2')]
    expect(selectTailForCompaction(history, Number.POSITIVE_INFINITY)).toEqual([])
    expect(selectTailForCompaction(history, 99)).toEqual(history)
  })
})

describe('rebuildHistoryAfterCompaction', () => {
  it('prepends an explicit boundary, summary, and keeps the selected tail', () => {
    const previous: PromptMessage[] = [txt('user', 'u1'), txt('assistant', 'a1'), txt('user', 'u2'), txt('assistant', 'a2')]
    const rehydrationPlan = buildDefaultCompactRehydrationPlan({
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
    })
    const next = rebuildHistoryAfterCompaction({
      summary: 'S',
      previousHistory: previous,
      keepLastTurns: 1,
      boundaryMeta: {
        trigger: 'manual',
        preTokens: 321,
        summaryKind: 'model_summary',
        keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
        rehydrationPlan,
      },
    })
    expect(next.length).toBe(4)
    expect(isCompactBoundaryMessage(next[0]!)).toBe(true)
    expect((next[0]!.meta?.compactBoundary as any)?.keepStrategy).toEqual({
      kind: 'keep_last_turns',
      keepLastTurns: 1,
    })
    expect((next[0]!.meta?.compactBoundary as any)?.rehydrationPlan).toEqual(rehydrationPlan)
    expect(next[1]!.role).toBe('user')
    expect((next[1]!.content as any[])[0]!.text).toContain('This session is being continued from a previous conversation')
    expect((next[1]!.content as any[])[0]!.text).toContain('S')
    expect((next[2]!.content as any[])[0]!.text).toBe('u2')
    expect((next[3]!.content as any[])[0]!.text).toBe('a2')
  })
})

describe('compaction summary helpers', () => {
  it('builds and strips explicit compact boundary messages', () => {
    const boundary = buildCompactBoundaryMessage({
      trigger: 'manual',
      preTokens: 123,
      summaryKind: 'model_summary',
      keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 0 },
      rehydrationPlan: buildDefaultCompactRehydrationPlan({
        mode: 'normal',
        planPath: null,
      }),
    })
    expect(isCompactBoundaryMessage(boundary)).toBe(true)
    expect((boundary.meta?.compactBoundary as any)?.trigger).toBe('manual')
    expect((boundary.meta?.compactBoundary as any)?.rehydrationPlan).toEqual({
      schemaVersion: 1,
      items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
    })
    expect(
      stripCompactBoundaryMessages([boundary, txt('user', 'kept')]),
    ).toEqual([txt('user', 'kept')])
  })

  it('builds a default rehydration plan from mode and plan-path state', () => {
    expect(buildDefaultCompactRehydrationPlan({ mode: 'normal', planPath: null })).toEqual({
      schemaVersion: 1,
      items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
    })
    expect(buildDefaultCompactRehydrationPlan({ mode: 'plan', planPath: '/repo/.formax/plan.md' })).toEqual({
      schemaVersion: 1,
      items: [
        { kind: 'recent_files', priority: 'high', status: 'planned' },
        { kind: 'plan_state', priority: 'high', status: 'planned' },
        { kind: 'mode_state', priority: 'medium', status: 'planned' },
      ],
    })
  })

  it('builds a user-summary preamble text block', () => {
    const text = buildCompactionSummaryUserText('hello')
    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text).toContain('This session is being continued from a previous conversation')
    expect(text).toContain('hello')
    expect(text.endsWith('</system-reminder>')).toBe(true)
  })

  it('normalizes falsy summary input to an empty body', () => {
    const text = buildCompactionSummaryUserText('' as any)
    expect(text).toContain('The conversation is summarized below:')
    expect(text).toContain('\n\n</system-reminder>')
  })

  it('detects compact summary user messages', () => {
    const msg: PromptMessage = {
      role: 'user',
      content: [{ type: 'text', text: buildCompactionSummaryUserText('S') }] as any,
    }
    expect(isCompactionSummaryUserMessage(msg)).toBe(true)
    expect(isCompactionSummaryUserMessage(txt('user', 'normal user text'))).toBe(false)
    expect(
      isCompactionSummaryUserMessage({
        role: 'user',
        content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] as any,
      }),
    ).toBe(false)
    expect(isCompactionSummaryUserMessage(txt('assistant', 'not user'))).toBe(false)
    expect(
      isCompactionSummaryUserMessage({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] as any,
      }),
    ).toBe(false)
    expect(
      isCompactionSummaryUserMessage({
        role: 'user',
        content: null as any,
      }),
    ).toBe(false)
    expect(
      isCompactionSummaryUserMessage({
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>   </system-reminder>' }] as any,
      }),
    ).toBe(false)
  })
})
