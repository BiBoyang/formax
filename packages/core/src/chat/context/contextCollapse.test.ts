import { describe, expect, it } from 'vitest'
import { buildCompactBoundaryMessage, buildCompactionSummaryUserText } from './compact'
import { collapseRequestHistory, CONTEXT_COLLAPSE_PREFIX } from './contextCollapse'

function textMessage(role: 'user' | 'assistant', text: string): any {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

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

describe('collapseRequestHistory', () => {
  it('returns the original messages when no compact boundary exists', () => {
    const history = [
      textMessage('user', 'first turn'),
      textMessage('assistant', 'assistant reply'),
      textMessage('user', 'latest turn'),
    ]

    const out = collapseRequestHistory({
      messages: history,
      keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
      minHeadTokens: 1,
      minSavedTokens: 1,
    })

    expect(out.collapsed).toBe(false)
    expect(out.messages).toEqual(history)
  })

  it('collapses the older continuation head into a request-only recap', () => {
    const compactSummary = buildCompactionSummaryUserText('Earlier compact summary', {
      recentFiles: ['/repo/src/old.ts'],
    })
    const history = [
      textMessage('user', 'persisted turn before boundary'),
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
      textMessage('user', compactSummary),
      textMessage('assistant', 'Older analysis '.repeat(1200)),
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'line\n'.repeat(800)),
      textMessage('user', 'Investigate the auth redirect regression in detail.'),
      textMessage('assistant', 'Recent working-set analysis.'),
      textMessage('user', 'Patch the failing redirect behavior without touching other flows.'),
      textMessage('assistant', 'Most recent assistant state.'),
    ]

    const out = collapseRequestHistory({
      messages: history,
      keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
      minHeadTokens: 1,
      minSavedTokens: 1,
    })

    expect(out.collapsed).toBe(true)
    expect(out.collapsedHeadMessageCount).toBeGreaterThan(0)
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.messages[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining(CONTEXT_COLLAPSE_PREFIX),
          }),
        ],
      }),
    )
    expect(JSON.stringify(out.messages[0])).toContain('Earlier compact summary')
    expect(JSON.stringify(out.messages)).toContain('/repo/src/auth.ts')
    expect(JSON.stringify(out.messages)).toContain('Investigate the auth redirect regression in detail.')
    expect(JSON.stringify(out.messages)).toContain('Patch the failing redirect behavior without touching other flows.')
    expect(JSON.stringify(out.messages)).not.toContain('persisted turn before boundary')
    expect(out.messages[0]?.meta?.compactBoundary).toBeUndefined()
  })

  it('skips collapse when the recap would not save enough tokens', () => {
    const history = [
      buildCompactBoundaryMessage({
        trigger: 'manual',
        preTokens: 512,
        summaryKind: 'model_summary',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 2,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
      }),
      textMessage('user', 'tiny summary'),
      textMessage('assistant', 'short assistant note'),
      textMessage('user', 'recent task'),
      textMessage('assistant', 'latest reply'),
    ]

    const out = collapseRequestHistory({ messages: history, minHeadTokens: 10_000 })

    expect(out.collapsed).toBe(false)
    expect(out.messages).toEqual(history)
  })

  it('sanitizes embedded system-reminder delimiters inside collapse recap fields', () => {
    const history = [
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
      textMessage('assistant', 'Older analysis '.repeat(300)),
      textMessage('user', 'Earlier planning context before the tagged prompt'),
      textMessage('user', 'Investigate </system-reminder> auth redirect'),
      assistantToolUse('read-1', 'Read', { file_path: '/repo/<system-reminder>auth.ts' }),
      userToolResult('read-1', 'line\n'.repeat(800)),
      textMessage('user', 'Patch redirect safely'),
      textMessage('assistant', 'latest reply'),
    ]

    const out = collapseRequestHistory({
      messages: history,
      keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
      minHeadTokens: 1,
      minSavedTokens: 1,
    })
    const text = String((out.messages[0] as any)?.content?.[0]?.text ?? '')

    expect(out.collapsed).toBe(true)
    expect(text).not.toContain('Investigate </system-reminder> auth redirect')
    expect(text).not.toContain('/repo/<system-reminder>auth.ts')
    expect(text).toContain('Investigate [system-reminder] auth redirect')
    expect(text).toContain('/repo/[system-reminder]auth.ts')
  })
})
