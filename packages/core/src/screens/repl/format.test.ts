import { describe, expect, it } from 'vitest'
import { formatTokenUsageSummary, formatTokens, sumTokens, truncate } from './format'

describe('repl format helpers', () => {
  it('formats token counts across ranges', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(1540)).toBe('1.5k')
    expect(formatTokens(99999)).toBe('100k')
    expect(formatTokens(100000)).toBe('100k')
    expect(formatTokens(999999)).toBe('1000k')
    expect(formatTokens(1000000)).toBe('1m')
    expect(formatTokens(1250000)).toBe('1.3m')
  })

  it('normalizes invalid or negative token values', () => {
    expect(formatTokens(Number.NaN)).toBe('0')
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatTokens(-12.7)).toBe('0')
  })

  it('sums all token usage buckets', () => {
    expect(sumTokens(undefined)).toBe(0)
    expect(
      sumTokens({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
        cache_deleted_input_tokens: 50,
      }),
    ).toBe(100)
    expect(sumTokens({ input_tokens: 5 })).toBe(5)
  })

  it('formats cache-deleted usage as a separate display-only bucket', () => {
    expect(formatTokenUsageSummary(undefined)).toBeNull()
    expect(formatTokenUsageSummary({ cache_deleted_input_tokens: 50 })).toBe('50 cache-deleted tokens')
    expect(
      formatTokenUsageSummary({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
        cache_deleted_input_tokens: 50,
      }),
    ).toBe('100 tokens · 50 cache-deleted tokens')
  })

  it('truncates long strings and preserves short strings', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
    expect(truncate('hello', 4)).toBe('hel…')
    expect(truncate('hello', 1)).toBe('…')
    expect(truncate('hello', 0)).toBe('hell…')
    expect(truncate('' as any, 3)).toBe('')
  })
})
