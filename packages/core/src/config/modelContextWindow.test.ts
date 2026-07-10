import { describe, expect, it } from 'vitest'
import {
  extractContextWindowTokens,
  getKnownContextWindowTokens,
  inferContextWindowTokens,
} from './modelContextWindow.js'

describe('modelContextWindow helpers', () => {
  it('extracts provider context-window fields from common payload shapes', () => {
    expect(extractContextWindowTokens({ context_window: '64000' })).toBe(64000)
    expect(extractContextWindowTokens({ token_limits: { maxInputTokenLength: 12345.6 } })).toBe(12346)
    expect(extractContextWindowTokens({ tokenLimits: { contextWindow: 204800 } })).toBe(204800)
    expect(extractContextWindowTokens({ limit: { context: 1000000 } })).toBe(1000000)
    expect(extractContextWindowTokens({ context_window: 0 })).toBeUndefined()
  })

  it('infers fallback context windows for known model families', () => {
    expect(inferContextWindowTokens('claude-3-5-sonnet')).toBe(200000)
    expect(inferContextWindowTokens('claude-sonnet-4-5-20250929')).toBe(200000)
    expect(inferContextWindowTokens('gateway/claude-haiku-4-5-20250929')).toBe(200000)
    expect(inferContextWindowTokens('gpt-4.1-mini')).toBe(128000)
    expect(inferContextWindowTokens('gateway/gpt-4.1-mini')).toBe(128000)
    expect(inferContextWindowTokens('gpt-4')).toBe(8192)
    expect(inferContextWindowTokens('gpt-3.5-turbo')).toBe(16385)
    expect(inferContextWindowTokens('pa/claude-sonnet-4-6-ppinfra')).toBe(32768)
    expect(inferContextWindowTokens('unknown-model')).toBe(32768)
  })

  it('keeps local known-model map conservative', () => {
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'claude-3-5-sonnet-latest' })).toBe(200000)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'pa/claude-3-5-sonnet-latest' })).toBe(200000)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'pa/claude-sonnet-4-5-20250929' })).toBe(200000)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'pa/claude-haiku-4-latest' })).toBe(200000)
    expect(getKnownContextWindowTokens({ provider: 'anthropic', model: 'pa/claude-sonnet-4-6-ppinfra' })).toBeNull()
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'gpt-4o' })).toBe(128000)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'openrouter/gpt-4o' })).toBe(128000)
    expect(getKnownContextWindowTokens({ provider: 'openai', model: 'o1' })).toBeNull()
    expect(getKnownContextWindowTokens({ provider: 'gemini', model: 'gemini-1.5-pro' })).toBeNull()
  })
})
