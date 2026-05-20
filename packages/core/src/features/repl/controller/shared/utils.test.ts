import { describe, expect, it } from 'vitest'
import { buildCompactionSummaryUserText } from '../../../../chat/context/compact'
import type { ChatHistory } from '../../../../chat/engine'
import {
  countNonToolUserTurns,
  extractAssistantText,
  formatDuration,
  formatTokenTotal,
  formatTokens,
  formatToolUses,
  isAbortLikeError,
  isExactSlashCommand,
  sumInputTokens,
  sumTokens,
} from './utils'

describe('isExactSlashCommand', () => {
  it('matches exact command after trim', () => {
    expect(isExactSlashCommand('   /clear   ', '/clear')).toBe(true)
  })

  it('does not match different command', () => {
    expect(isExactSlashCommand('/compact', '/clear')).toBe(false)
  })
})

describe('isAbortLikeError', () => {
  it('returns false for empty input', () => {
    expect(isAbortLikeError(null)).toBe(false)
  })

  it('matches AbortError name', () => {
    expect(isAbortLikeError({ name: 'AbortError' })).toBe(true)
  })

  it('matches known abort messages and generic aborted text', () => {
    expect(isAbortLikeError({ message: 'Stream aborted' })).toBe(true)
    expect(isAbortLikeError({ message: 'Request aborted' })).toBe(true)
    expect(isAbortLikeError({ message: 'operation was ABORTED by user' })).toBe(true)
  })
})

describe('tool/token formatting', () => {
  it('formats tool uses with singular/plural and sanitization', () => {
    expect(formatToolUses(1)).toBe('1 tool use')
    expect(formatToolUses(2.9)).toBe('2 tool uses')
    expect(formatToolUses(-1)).toBe('0 tool uses')
    expect(formatToolUses(Number.NaN)).toBe('0 tool uses')
  })

  it('sums input-only and total tokens', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 7,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
      cache_deleted_input_tokens: 6,
    }
    expect(sumInputTokens(usage)).toBe(13)
    expect(sumTokens(usage)).toBe(20)
    expect(sumInputTokens(undefined)).toBe(0)
    expect(sumTokens(undefined)).toBe(0)
  })

  it('formats token totals and returns null when non-positive', () => {
    expect(formatTokenTotal(undefined)).toBeNull()
    expect(formatTokenTotal({ input_tokens: 999 })).toBe('999')
  })

  it('formats token ranges with k/m units', () => {
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(100000)).toBe('100k')
    expect(formatTokens(1500000)).toBe('1.5m')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})

describe('formatDuration', () => {
  it('formats seconds/minutes/hours', () => {
    expect(formatDuration(1500)).toBe('2s')
    expect(formatDuration(61_000)).toBe('1m 1s')
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s')
    expect(formatDuration(Number.NaN)).toBe('0s')
  })
})

describe('countNonToolUserTurns', () => {
  it('counts only non-tool user turns and skips compaction summary', () => {
    const history = [
      null,
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'plain user text' },
      {
        role: 'user',
        content: [{ type: 'text', text: buildCompactionSummaryUserText('summary') }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', content: 'ok' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'normal typed block' }],
      },
    ] as any as ChatHistory

    expect(countNonToolUserTurns(history)).toBe(2)
  })
})

describe('extractAssistantText', () => {
  it('returns last assistant string content', () => {
    const history = [
      { role: 'assistant', content: 'older' },
      { role: 'assistant', content: 'latest' },
    ] as any as ChatHistory
    expect(extractAssistantText(history)).toBe('latest')
  })

  it('joins last assistant text blocks and ignores non-text blocks', () => {
    const history = [
      { role: 'assistant', content: 'older' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: 'b' }],
      },
    ] as any as ChatHistory
    expect(extractAssistantText(history)).toBe('ab')
  })

  it('returns empty string when no assistant text can be extracted', () => {
    const history = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'x' }] },
    ] as any as ChatHistory
    expect(extractAssistantText(history)).toBe('')
  })

  it('returns empty string when there are no assistant messages', () => {
    const history = [{ role: 'user', content: 'u1' }] as any as ChatHistory
    expect(extractAssistantText(history)).toBe('')
  })

  it('skips assistant messages with non-string and non-array content', () => {
    const history = [
      { role: 'assistant', content: 'fallback' },
      { role: 'assistant', content: { unexpected: true } },
    ] as any as ChatHistory
    expect(extractAssistantText(history)).toBe('fallback')
  })
})
