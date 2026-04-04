import { describe, expect, it } from 'vitest'
import { microCompactHistory } from './microCompact'
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
})
