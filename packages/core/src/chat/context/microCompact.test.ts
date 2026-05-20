import { describe, expect, it } from 'vitest'
import { microCompactHistory, resolveAdaptiveMicroCompactPolicy } from './microCompact'
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

describe('microCompactHistory', () => {
  it('microcompacts older eligible tool results while keeping recent results intact', () => {
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

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(1)
    expect(out.compactedToolNames).toEqual(['Read'])
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect(out.keptRecentBlocks).toBe(3)
    expect((out.messages[1]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/auth.ts (~4,000 chars)]',
    )
    expect((out.messages[3]!.content[0] as any).content).toBe('b'.repeat(4000))
    expect((out.messages[5]!.content[0] as any).content).toBe('c'.repeat(4000))
    expect((out.messages[7]!.content[0] as any).content).toBe('d'.repeat(4000))
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

  it('preserves non-tool text blocks while clearing only the tool_result payload', () => {
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

    const out = microCompactHistory({ messages })
    const oldMessage = out.messages[1]!

    expect(oldMessage.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'read-1',
      content: '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    })
    expect(oldMessage.content[1]).toEqual({ type: 'text', text: 'extra reminder' })
  })

  it('microcompacts older machine-generated Skill companion blocks without touching the launch stub', () => {
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

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(1)
    expect(out.compactedToolNames).toEqual(['Skill'])
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect((oldMessage.content[0] as any).content).toBe('Launching skill: frontend-design')
    expect((oldMessage.content[1] as any).text).toBe(
      `[Older companion block cleared by microcompact: Skill(frontend-design) body (~${oldCompanionText.length.toLocaleString('en-US')} chars)]`,
    )
    expect((out.messages[3]!.content[1] as any).text).toContain('Base directory for this skill')
  })

  it('preserves Skill companion block microcompaction when cache editing is enabled', () => {
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

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(1)
    expect(out.compactedToolNames).toEqual(['Skill'])
    expect(out.cacheEditPlan).toBeNull()
    expect(out.cacheEditingPlannedBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect((oldMessage.content[0] as any).content).toBe('Launching skill: frontend-design')
    expect((oldMessage.content[1] as any).text).toBe(
      `[Older companion block cleared by microcompact: Skill(frontend-design) body (~${oldCompanionText.length.toLocaleString('en-US')} chars)]`,
    )
    expect((messages[1]!.content[1] as any).text).toBe(oldCompanionText)
  })

  it('keeps ordinary trailing text blocks intact even for Skill tool results', () => {
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

    const out = microCompactHistory({ messages })

    expect((out.messages[1]!.content[1] as any).text).toBe('human note '.repeat(300))
    expect((out.messages[3]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    )
  })

  it('keeps Bash and WebFetch results intact by default', () => {
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

    const out = microCompactHistory({ messages, keepRecentToolResults: 0 })

    expect(out.compactedToolNames).toEqual(['Read'])
    expect(out.keptRecentBlocks).toBe(0)
    expect(out.estimatedTokensSaved).toBeGreaterThan(0)
    expect((out.messages[1]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/a.ts (~4,000 chars)]',
    )
    expect((out.messages[3]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/b.ts (~4,000 chars)]',
    )
    expect((out.messages[5]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/src/c.ts (~4,000 chars)]',
    )
    expect((out.messages[7]!.content[0] as any).content).toBe(
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

    const out = microCompactHistory({ messages, keepRecentToolResults: 0 })
    const stub = String((out.messages[1]!.content[0] as any).content)

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

    const out = microCompactHistory({ messages, keepRecentToolResults: 0 })

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

    const out = microCompactHistory({ messages, keepRecentToolResults: 0, minResultChars: 1 })

    expect((out.messages[1]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Grep "login" in /repo/src (3 hits)]',
    )
    expect((out.messages[3]!.content[0] as any).content).toBe(
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
    expect((out.messages[1]!.content[0] as any).content).toContain(
      '[Older tool result cleared by microcompact: Read /repo/src/auth.ts',
    )
    expect((out.messages[3]!.content[0] as any).content).toContain(
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
      timeAwareEligibleToolNames: ['Read', 'Grep', 'Glob'],
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
      timeAwareEligibleToolNames: ['Read', 'Grep', 'Glob'],
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
      timeAwareEligibleToolNames: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'],
      timeAwareMinResultChars: 600,
      timeAwareMinResultCharsByName: { Bash: 900, WebFetch: 900 },
      timeAwareMinStaleUserTurns: 2,
    })
  })

  it('time-aware microcompacts stale medium results once enough user turns have passed', () => {
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

    expect(out.compacted).toBe(true)
    expect(out.compactedBlocks).toBe(1)
    expect(out.timeAwareCompactedBlocks).toBe(1)
    expect(out.timeAwareToolNames).toEqual(['Read'])
    expect(out.cacheAwareCompactedBlocks).toBe(0)
    expect((out.messages[1]!.content[0] as any).content).toContain(
      '[Older tool result cleared by microcompact: Read /repo/src/auth.ts',
    )
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
    })

    expect((out.messages[1]!.content[0] as any).content).toBe('a'.repeat(4000))
    expect((out.messages[3]!.content[0] as any).content).toContain('[Older tool result cleared by microcompact: Grep')
    expect((out.messages[5]!.content[0] as any).content).toContain('[Older tool result cleared by microcompact: Glob')
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
    })

    expect((out.messages[1]!.content[0] as any).content).toBe(
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
    })

    expect((out.messages[1]!.content[0] as any).content).toBe(
      '[Older tool result cleared by microcompact: Bash "cat /repo/README.md"]',
    )
    expect((out.messages[3]!.content[0] as any).content).toBe(
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
