import { describe, expect, it } from 'vitest'
import {
  microCompactHistory,
  resolveAdaptiveMicroCompactPolicy,
  TIME_BASED_MC_CLEARED_MESSAGE,
} from './microCompact'
import type { PromptMessage } from '../../prompts'

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }] as any,
  }
}

function userToolResult(id: string, content: string, extraBlocks: any[] = [], isError = false): PromptMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content,
        ...(isError ? { is_error: true } : {}),
      },
      ...extraBlocks,
    ] as any,
  }
}

function fallbackBlock(out: ReturnType<typeof microCompactHistory>, messageIndex: number, blockIndex = 0): any {
  return (out.cacheEditPlan?.fallbackMessages?.[messageIndex]?.content as any[])?.[blockIndex]
}

describe('microCompactHistory', () => {
  it('no-ops when cache editing is unavailable and assistant-gap microcompact does not fire', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'b'.repeat(4000)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'c'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-2', 'd'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages })

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.cacheEditPlan).toBeNull()
    expect(out.estimatedTokensSaved).toBe(0)
    expect(out.messages).toBe(messages)
  })

  it('plans cache edits without mutating message content when cache editing is enabled', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 1,
      enableCacheEditing: true,
    })

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(1)
    expect(out.compactedToolNames).toEqual(['Read'])
    expect(out.cacheEditPlan).toEqual({
      provider: 'anthropic',
      deletes: [
        {
          type: 'delete',
          cacheReference: 'read-1',
          toolUseId: 'read-1',
          toolName: 'Read',
          messageIndex: 1,
          blockIndex: 0,
        },
      ],
      fallbackMessages: [
        assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
        userToolResult('read-1', '[Older tool result cleared by microcompact: Read /repo/src/auth.ts (~4,000 chars)]'),
        assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
        userToolResult('read-2', 'b'.repeat(4000)),
      ],
    })
    expect(out.messages).toBe(messages)
    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
  })

  it('does not plan duplicate cache edit deletes for the same tool_use_id', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      userToolResult('read-1', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      enableCacheEditing: true,
    })

    expect(out.cacheEditPlan?.deletes).toEqual([
      {
        type: 'delete',
        cacheReference: 'read-1',
        toolUseId: 'read-1',
        toolName: 'Read',
        messageIndex: 1,
        blockIndex: 0,
      },
    ])
    expect(out.cacheEditingPlannedBlocks).toBe(1)
  })

  it('does not cache-edit microcompact durable tool-result content replacements', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-durable', 'Read', { file_path: '/repo/src/durable.ts' }),
      {
        ...userToolResult('read-durable', '[durable replacement] '.repeat(500)),
        meta: {
          durableToolResultContentReplacementToolUseIds: ['read-durable'],
        } as any,
      },
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1,
      eligibleToolNames: ['Read'],
      enableCacheEditing: true,
    })

    expect(out.compacted).toBe(false)
    expect(out.cacheEditPlan).toBeNull()
    expect(out.messages).toBe(messages)
    expect((out.messages[1]!.content[0] as any).content).toContain('[durable replacement]')
  })

  it('time-based microcompacts old tool results after an assistant wall-clock gap and skips cache edits', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] as any, meta: { timestamp: '2026-05-21T00:00:00.000Z' } },
    ]

    const out = microCompactHistory({
      messages,
      enableCacheEditing: true,
      enableTimeBasedMicroCompact: true,
      timeBasedAssistantGapThresholdMinutes: 60,
      timeBasedKeepRecentToolResults: 1,
      nowMs: new Date('2026-05-21T02:01:00.000Z').getTime(),
    })

    expect(out.cacheEditPlan).toBeNull()
    expect((out.messages[1]!.content[0] as any).content).toBe(TIME_BASED_MC_CLEARED_MESSAGE)
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
    expect(out.timeAwareCompactedBlocks).toBe(1)
    expect(out.timeAwareToolNames).toEqual(['Read'])
  })

  it('does not time-based microcompact durable tool-result content replacements', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-durable', 'Read', { file_path: '/repo/src/durable.ts' }),
      {
        ...userToolResult('read-durable', '[durable replacement] '.repeat(500)),
        meta: {
          durableToolResultContentReplacementToolUseIds: ['read-durable'],
        } as any,
      },
      assistantToolUse('read-recent', 'Read', { file_path: '/repo/src/recent.ts' }),
      userToolResult('read-recent', 'recent'.repeat(900)),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] as any, meta: { timestamp: '2026-05-21T00:00:00.000Z' } },
    ]

    const out = microCompactHistory({
      messages,
      enableCacheEditing: true,
      enableTimeBasedMicroCompact: true,
      timeBasedAssistantGapThresholdMinutes: 60,
      timeBasedKeepRecentToolResults: 1,
      nowMs: new Date('2026-05-21T02:01:00.000Z').getTime(),
    })

    expect(out.compacted).toBe(false)
    expect(out.cacheEditPlan).toBeNull()
    expect(out.messages).toBe(messages)
    expect((out.messages[1]!.content[0] as any).content).toContain('[durable replacement]')
    expect((out.messages[3]!.content[0] as any).content).not.toBe(TIME_BASED_MC_CLEARED_MESSAGE)
  })

  it('does not time-based microcompact when cache editing is unavailable', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] as any, meta: { timestamp: '2026-05-21T00:00:00.000Z' } },
    ]

    const out = microCompactHistory({
      messages,
      enableTimeBasedMicroCompact: true,
      timeBasedAssistantGapThresholdMinutes: 60,
      timeBasedKeepRecentToolResults: 1,
      nowMs: new Date('2026-05-21T02:01:00.000Z').getTime(),
    })

    expect(out.compacted).toBe(false)
    expect(out.cacheEditPlan).toBeNull()
    expect(out.messages).toBe(messages)
  })

  it('does not time-based microcompact when the assistant timestamp gap is below threshold', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] as any, meta: { timestamp: '2026-05-21T00:30:00.000Z' } },
    ]

    const out = microCompactHistory({
      messages,
      enableTimeBasedMicroCompact: true,
      timeBasedAssistantGapThresholdMinutes: 60,
      timeBasedKeepRecentToolResults: 1,
      nowMs: new Date('2026-05-21T01:00:00.000Z').getTime(),
    })

    expect(out.compacted).toBe(false)
    expect(out.messages).toBe(messages)
  })

  it('suppresses cache edits after an assistant wall-clock gap even when no time-based blocks are cleared', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
      userToolResult('read-3', 'c'.repeat(4000)),
      assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-4', 'd'.repeat(4000)),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] as any, meta: { timestamp: '2026-05-21T00:00:00.000Z' } },
    ]

    const out = microCompactHistory({
      messages,
      enableCacheEditing: true,
      enableTimeBasedMicroCompact: true,
      timeBasedAssistantGapThresholdMinutes: 60,
      nowMs: new Date('2026-05-21T02:01:00.000Z').getTime(),
    })

    expect(out.compacted).toBe(false)
    expect(out.cacheEditPlan).toBeNull()
    expect(out.messages).toBe(messages)
    expect(out.keptRecentBlocks).toBe(4)
  })

  it('skips ineligible, small, error, and already microcompacted results', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('task-1', 'Task', { description: 'delegate' }),
      userToolResult('task-1', 'x'.repeat(4000)),
      assistantToolUse('read-small', 'Read', { file_path: '/repo/src/small.ts' }),
      userToolResult('read-small', 'short'),
      assistantToolUse('grep-error', 'Grep', { pattern: 'oops', path: '/repo/src' }),
      userToolResult('grep-error', 'y'.repeat(4000), [], true),
      assistantToolUse('read-old', 'Read', { file_path: '/repo/src/already.ts' }),
      userToolResult('read-old', '[Older tool result cleared by microcompact: Read /repo/src/already.ts]'),
    ]

    const out = microCompactHistory({ messages, keepRecentToolResults: 0 })

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.compactedToolNames).toEqual([])
    expect(out.estimatedTokensSaved).toBe(0)
    expect(out.keptRecentBlocks).toBe(0)
    expect(out.messages).toBe(messages)
  })

  it('keeps non-tool text blocks intact in cache-editing fallback messages', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000), [{ type: 'text', text: 'extra reminder' }]),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
      userToolResult('read-3', 'c'.repeat(4000)),
      assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-4', 'd'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages, enableCacheEditing: true })
    const oldMessage = out.cacheEditPlan!.fallbackMessages![1]!

    expect(oldMessage.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'read-1',
      content: '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    })
    expect(oldMessage.content[1]).toEqual({ type: 'text', text: 'extra reminder' })
  })

  it('leaves Skill companion blocks unchanged when cache editing is unavailable', () => {
    const oldCompanionText = `Base directory for this skill: /repo/.formax/skills/frontend-design\n\n${'A'.repeat(4000)}`
    const messages: PromptMessage[] = [
      assistantToolUse('skill-1', 'Skill', { skill: 'frontend-design' }),
      userToolResult('skill-1', 'Launching skill: frontend-design', [
        {
          type: 'text',
          text: oldCompanionText,
        },
      ]),
      assistantToolUse('skill-2', 'Skill', { skill: 'pdf' }),
      userToolResult('skill-2', 'Launching skill: pdf', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/pdf\n\n${'B'.repeat(4000)}`,
        },
      ]),
      assistantToolUse('skill-3', 'Skill', { skill: 'release' }),
      userToolResult('skill-3', 'Launching skill: release', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/release\n\n${'C'.repeat(4000)}`,
        },
      ]),
      assistantToolUse('skill-4', 'Skill', { skill: 'qa' }),
      userToolResult('skill-4', 'Launching skill: qa', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/qa\n\n${'D'.repeat(4000)}`,
        },
      ]),
    ]

    const out = microCompactHistory({ messages })
    const oldMessage = out.messages[1]!

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.compactedToolNames).toEqual([])
    expect(out.estimatedTokensSaved).toBe(0)
    expect((oldMessage.content[0] as any).content).toBe('Launching skill: frontend-design')
    expect((oldMessage.content[1] as any).text).toBe(oldCompanionText)
    expect((out.messages[3]!.content[1] as any).text).toContain('Base directory for this skill')
  })

  it('does not mutate Skill companion blocks when cache editing is enabled', () => {
    const oldCompanionText = `Base directory for this skill: /repo/.formax/skills/frontend-design\n\n${'A'.repeat(4000)}`
    const messages: PromptMessage[] = [
      assistantToolUse('skill-1', 'Skill', { skill: 'frontend-design' }),
      userToolResult('skill-1', 'Launching skill: frontend-design', [
        {
          type: 'text',
          text: oldCompanionText,
        },
      ]),
      assistantToolUse('skill-2', 'Skill', { skill: 'pdf' }),
      userToolResult('skill-2', 'Launching skill: pdf', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/pdf\n\n${'B'.repeat(4000)}`,
        },
      ]),
      assistantToolUse('skill-3', 'Skill', { skill: 'release' }),
      userToolResult('skill-3', 'Launching skill: release', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/release\n\n${'C'.repeat(4000)}`,
        },
      ]),
      assistantToolUse('skill-4', 'Skill', { skill: 'qa' }),
      userToolResult('skill-4', 'Launching skill: qa', [
        {
          type: 'text',
          text: `Base directory for this skill: /repo/.formax/skills/qa\n\n${'D'.repeat(4000)}`,
        },
      ]),
    ]

    const out = microCompactHistory({ messages, enableCacheEditing: true })
    const oldMessage = out.messages[1]!

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.compactedToolNames).toEqual([])
    expect(out.cacheEditPlan).toBeNull()
    expect(out.cacheEditingPlannedBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBe(0)
    expect((oldMessage.content[0] as any).content).toBe('Launching skill: frontend-design')
    expect((oldMessage.content[1] as any).text).toBe(oldCompanionText)
    expect((messages[1]!.content[1] as any).text).toBe(oldCompanionText)
  })

  it('keeps ordinary trailing text blocks intact in cache-editing fallback messages', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('skill-1', 'Skill', { skill: 'frontend-design' }),
      userToolResult('skill-1', 'Launching skill: frontend-design', [{ type: 'text', text: 'human note '.repeat(300) }]),
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
      userToolResult('read-3', 'c'.repeat(4000)),
      assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-4', 'd'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages, enableCacheEditing: true })

    expect((out.messages[1]!.content[1] as any).text).toBe('human note '.repeat(300))
    expect(fallbackBlock(out, 3).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    )
  })

  it('keeps Bash and WebFetch results intact in cache-editing fallback unless eligible', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
      userToolResult('read-2', 'b'.repeat(4000)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
      userToolResult('read-3', 'c'.repeat(4000)),
      assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-4', 'd'.repeat(4000)),
      assistantToolUse('bash-1', 'Bash', { command: 'npm test -- --watch=false' }),
      userToolResult('bash-1', 'e'.repeat(4000)),
      assistantToolUse('fetch-1', 'WebFetch', { url: 'https://example.com/docs' }),
      userToolResult('fetch-1', 'f'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages, keepRecentToolResults: 0, enableCacheEditing: true })

    expect(out.compactedToolNames).toEqual(['Read'])
    expect(out.keptRecentBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect(fallbackBlock(out, 1).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    )
    expect(fallbackBlock(out, 3).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/b.ts (~4,000 chars)]',
    )
    expect(fallbackBlock(out, 5).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/c.ts (~4,000 chars)]',
    )
    expect(fallbackBlock(out, 7).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/d.ts (~4,000 chars)]',
    )
    expect((out.messages[9]!.content[0] as any).content).toBe('e'.repeat(4000))
    expect((out.messages[11]!.content[0] as any).content).toBe('f'.repeat(4000))
  })

  it('clips long tool summaries so stubs stay short', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: `/repo/${'nested/'.repeat(24)}very-long-file-name.ts` }),
      userToolResult('read-1', 'a'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages, keepRecentToolResults: 0, enableCacheEditing: true })
    const stub = String(fallbackBlock(out, 1).content)

    expect(stub).toContain('...')
    expect(stub.length).toBeLessThanOrEqual(120)
  })

  it('tracks compacted tool names in first-compaction order across tool types', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'b'.repeat(4000)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'c'.repeat(4000)),
    ]

    const out = microCompactHistory({ messages, keepRecentToolResults: 0, enableCacheEditing: true })

    expect(out.compactedBlocks).toBe(3)
    expect(out.compactedToolNames).toEqual(['Read', 'Grep', 'Glob'])
    expect(out.keptRecentBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
  })

  it('adds approximate hit and path counts to Grep and Glob stubs', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'a.ts:10:login\nb.ts:12:login\nc.ts:14:login'),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'src/a.ts\nsrc/b.ts\nsrc/c.ts'),
    ]

    const out = microCompactHistory({ messages, keepRecentToolResults: 0, minResultChars: 1, enableCacheEditing: true })

    expect(fallbackBlock(out, 1).content).toBe(
      '[Older tool result cleared by microcompact: Grep "login" in /repo/src (3 hits)]',
    )
    expect(fallbackBlock(out, 3).content).toBe(
      '[Older tool result cleared by microcompact: Glob "**/*.ts" in /repo/src (3 paths)]',
    )
  })

  it('compacts older duplicate cache-like results even when they are below the standard size threshold', () => {
    const duplicatedRead = 'line\n'.repeat(120)
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', duplicatedRead),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-2', duplicatedRead),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-3', 'z'.repeat(5000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 1,
      cacheAwareEligibleToolNames: ['Read'],
      cacheAwareMinResultChars: 400,
      minResultChars: 2000,
      eligibleToolNames: ['Read'],
      enableCacheEditing: true,
    })

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(2)
    expect(out.compactedToolNames).toEqual(['Read'])
    expect(out.cacheAwareCompactedBlocks).toBe(2)
    expect(out.cacheAwareToolNames).toEqual(['Read'])
    expect(out.cacheAwareEligibleToolNames).toEqual(['Read'])
    expect(out.cacheAwareMinResultChars).toBe(400)
    expect(out.timeAwareCompactedBlocks).toBe(0)
    expect(out.timeAwareToolNames).toEqual([])
    expect(fallbackBlock(out, 1).content).toContain(
      '[Older tool result cleared by microcompact: Read /repo/src/auth.ts',
    )
    expect(fallbackBlock(out, 3).content).toContain(
      '[Older tool result cleared by microcompact: Read /repo/src/auth.ts',
    )
    expect((out.messages[5]!.content[0] as any).content).toBe('z'.repeat(5000))
  })

  it('does not count unique cache-aware candidates as compacted when no duplicate path is present', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'a'.repeat(600)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-2', 'b'.repeat(600)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/redirect.ts' }),
      userToolResult('read-3', 'c'.repeat(600)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 1,
      cacheAwareEligibleToolNames: ['Read'],
      cacheAwareMinResultChars: 400,
      minResultChars: 2000,
      eligibleToolNames: ['Read'],
    })

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBe(0)
    expect(out.cacheAwareCompactedBlocks).toBe(0)
    expect(out.timeAwareCompactedBlocks).toBe(0)
    expect(out.messages).toBe(messages)
  })

  it('resolves predictable adaptive policies for different pressure tiers', () => {
    expect(resolveAdaptiveMicroCompactPolicy({ pressureRatio: null })).toEqual({
      pressureTier: 'default',
      eligibleToolNames: ['Read', 'Grep', 'Glob', 'Skill'],
      keepRecentToolResults: 3,
      keepRecentToolResultsByName: { Read: 2, Skill: 1 },
      minResultChars: 1200,
      minResultCharsByName: {},
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 900,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 3,
    })
    expect(resolveAdaptiveMicroCompactPolicy({ pressureRatio: 0.3 })).toEqual({
      pressureTier: 'relaxed',
      eligibleToolNames: ['Read', 'Skill'],
      keepRecentToolResults: 4,
      keepRecentToolResultsByName: { Read: 2, Skill: 2 },
      minResultChars: 2400,
      minResultCharsByName: {},
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 600,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 1400,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 4,
    })
    expect(resolveAdaptiveMicroCompactPolicy({ pressureRatio: 0.6 })).toEqual({
      pressureTier: 'steady',
      eligibleToolNames: ['Read', 'Grep', 'Skill'],
      keepRecentToolResults: 3,
      keepRecentToolResultsByName: { Read: 2, Grep: 1, Skill: 1 },
      minResultChars: 1600,
      minResultCharsByName: { Grep: 1000 },
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 500,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 1000,
      timeAwareMinResultCharsByName: { Grep: 700, Glob: 700 },
      timeAwareMinStaleUserTurns: 4,
    })
    expect(resolveAdaptiveMicroCompactPolicy({ pressureRatio: 0.8 })).toEqual({
      pressureTier: 'tight',
      eligibleToolNames: ['Read', 'Grep', 'Glob', 'Skill'],
      keepRecentToolResults: 2,
      keepRecentToolResultsByName: { Read: 1, Skill: 1 },
      minResultChars: 1200,
      minResultCharsByName: { Grep: 900, Glob: 900 },
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 400,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 800,
      timeAwareMinResultCharsByName: { Grep: 600, Glob: 600 },
      timeAwareMinStaleUserTurns: 3,
    })
    expect(resolveAdaptiveMicroCompactPolicy({ pressureRatio: 0.95 })).toEqual({
      pressureTier: 'critical',
      eligibleToolNames: ['Read', 'Grep', 'Glob', 'Skill', 'Bash', 'WebFetch'],
      keepRecentToolResults: 1,
      keepRecentToolResultsByName: { Read: 1 },
      minResultChars: 800,
      minResultCharsByName: { Grep: 600, Glob: 600, Bash: 1200, WebFetch: 1200 },
      cacheAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'WebFetch'],
      cacheAwareMinResultChars: 300,
      timeAwareEligibleToolNames: [],
      timeAwareMinResultChars: 600,
      timeAwareMinResultCharsByName: { Bash: 900, WebFetch: 900 },
      timeAwareMinStaleUserTurns: 2,
    })
  })

  it('does not run user-turn-based time-aware microcompact', () => {
    const mediumRead = 'line\n'.repeat(170)
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', mediumRead),
      { role: 'user', content: [{ type: 'text', text: 'Investigate auth regression' }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking auth flow.' }] as any },
      { role: 'user', content: [{ type: 'text', text: 'Now isolate redirect behavior' }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Inspecting redirect logic.' }] as any },
      { role: 'user', content: [{ type: 'text', text: 'Also confirm stale guard.' }] as any },
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1600,
      minResultCharsByName: {},
      eligibleToolNames: ['Read'],
      timeAwareEligibleToolNames: ['Read'],
      timeAwareMinResultChars: 600,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 3,
    })

    expect(out.compacted).toBe(false)
    expect(out.compactedBlocks).toBe(0)
    expect(out.timeAwareCompactedBlocks).toBe(0)
    expect(out.timeAwareToolNames).toEqual([])
    expect(out.cacheAwareCompactedBlocks).toBe(0)
    expect((out.messages[1]!.content[0] as any).content).toBe(mediumRead)
  })

  it('does not time-aware microcompact medium results before they become stale enough', () => {
    const mediumRead = 'line\n'.repeat(170)
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', mediumRead),
      { role: 'user', content: [{ type: 'text', text: 'Investigate auth regression' }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking auth flow.' }] as any },
      { role: 'user', content: [{ type: 'text', text: 'Now isolate redirect behavior' }] as any },
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1600,
      minResultCharsByName: {},
      eligibleToolNames: ['Read'],
      timeAwareEligibleToolNames: ['Read'],
      timeAwareMinResultChars: 600,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 3,
    })

    expect(out.compacted).toBe(false)
    expect(out.timeAwareCompactedBlocks).toBe(0)
    expect((out.messages[1]!.content[0] as any).content).toBe(mediumRead)
  })

  it('uses subsequent user turns, not assistant-only drift, for time-aware staleness', () => {
    const mediumRead = 'line\n'.repeat(170)
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', mediumRead),
      { role: 'assistant', content: [{ type: 'text', text: 'Checking auth flow.' }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Inspecting redirect logic.' }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Confirming stale guard.' }] as any },
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1600,
      minResultCharsByName: {},
      eligibleToolNames: ['Read'],
      timeAwareEligibleToolNames: ['Read'],
      timeAwareMinResultChars: 600,
      timeAwareMinResultCharsByName: {},
      timeAwareMinStaleUserTurns: 1,
    })

    expect(out.compacted).toBe(false)
    expect(out.timeAwareCompactedBlocks).toBe(0)
    expect((out.messages[1]!.content[0] as any).content).toBe(mediumRead)
  })

  it('prefers recent Read blocks over newer low-value search/list results when recent budgets are tight', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'b'.repeat(4000)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'c'.repeat(4000)),
      assistantToolUse('grep-2', 'Grep', { pattern: 'redirect', path: '/repo/src' }),
      userToolResult('grep-2', 'd'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 2,
      keepRecentToolResultsByName: { Read: 1 },
      minResultChars: 1,
      eligibleToolNames: ['Read', 'Grep', 'Glob'],
      enableCacheEditing: true,
    })

    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect(fallbackBlock(out, 3).content).toContain('[Older tool result cleared by microcompact: Grep')
    expect(fallbackBlock(out, 5).content).toContain('[Older tool result cleared by microcompact: Glob')
    expect((out.messages[7]!.content[0] as any).content).toBe('d'.repeat(4000))
  })

  it('allows lower per-tool size thresholds for medium Grep results under tighter strategies', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'match\n'.repeat(180)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1600,
      minResultCharsByName: { Grep: 900 },
      eligibleToolNames: ['Grep'],
      enableCacheEditing: true,
    })

    expect(fallbackBlock(out, 1).content).toBe(
      '[Older tool result cleared by microcompact: Grep "login" in /repo/src (180 hits)]',
    )
  })

  it('allows safe Bash and stable WebFetch results to microcompact', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('bash-1', 'Bash', { command: 'cat /repo/README.md' }),
      userToolResult('bash-1', 'a'.repeat(4000)),
      assistantToolUse('fetch-1', 'WebFetch', { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' }),
      userToolResult('fetch-1', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1,
      eligibleToolNames: ['Bash', 'WebFetch'],
      enableCacheEditing: true,
    })

    expect(fallbackBlock(out, 1).content).toBe(
      '[Older tool result cleared by microcompact: Bash "cat /repo/README.md"]',
    )
    expect(fallbackBlock(out, 3).content).toBe(
      '[Older tool result cleared by microcompact: WebFetch https://developer.mozilla.org/en-US/docs/Web/JavaScript]',
    )
  })

  it('keeps unsafe Bash and unstable WebFetch results intact', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('bash-1', 'Bash', { command: 'npm install && npm test' }),
      userToolResult('bash-1', 'a'.repeat(4000)),
      assistantToolUse('fetch-1', 'WebFetch', { url: 'https://example.com/search?q=test' }),
      userToolResult('fetch-1', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1,
      eligibleToolNames: ['Bash', 'WebFetch'],
    })

    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
  })

  it('keeps composed Bash commands with separators or newlines intact', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('bash-1', 'Bash', { command: 'cat /repo/README.md & rm -rf /tmp/demo' }),
      userToolResult('bash-1', 'a'.repeat(4000)),
      assistantToolUse('bash-2', 'Bash', { command: 'cat /repo/README.md\nrm -rf /tmp/demo' }),
      userToolResult('bash-2', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1,
      eligibleToolNames: ['Bash'],
    })

    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
  })

  it('keeps mutating single-command Bash invocations intact', () => {
    const messages: PromptMessage[] = [
      assistantToolUse('bash-1', 'Bash', { command: 'sed -i "" "s/a/b/" /repo/file.ts' }),
      userToolResult('bash-1', 'a'.repeat(4000)),
      assistantToolUse('bash-2', 'Bash', { command: 'find . -delete' }),
      userToolResult('bash-2', 'b'.repeat(4000)),
    ]

    const out = microCompactHistory({
      messages,
      keepRecentToolResults: 0,
      minResultChars: 1,
      eligibleToolNames: ['Bash'],
    })

    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
  })
})
