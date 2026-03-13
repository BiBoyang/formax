import { describe, expect, it } from 'vitest'
import { getKnownContextWindowTokens } from './modelWindow'

describe('modelWindow', () => {
  it('returns 200k for Claude 3 family', () => {
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'claude-3-5-sonnet-latest' })).toBe(200_000)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'claude-3-haiku-latest' })).toBe(200_000)
  })

  it('returns known OpenAI context windows', () => {
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'gpt-4o' })).toBe(128_000)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'gpt-4-turbo' })).toBe(128_000)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'gpt-3.5-turbo' })).toBe(16_385)
  })

  it('returns null when unknown', () => {
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'o1' })).toBe(null)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'unknown-model' })).toBe(null)
    expect(getKnownContextWindowTokens({ provider: 'gemini', model: 'gemini-1.5-pro' })).toBe(null)
    expect(getKnownContextWindowTokens({ provider: 'unknown', model: 'something' })).toBe(null)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: '   ' })).toBe(null)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: undefined as any })).toBe(null)
  })
})
