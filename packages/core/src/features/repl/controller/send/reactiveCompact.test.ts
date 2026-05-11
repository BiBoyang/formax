import { describe, expect, it } from 'vitest'
import { classifyReactiveCompactError, isReactiveCompactEligibleError } from './reactiveCompact'

describe('isReactiveCompactEligibleError', () => {
  it('matches common provider context overflow errors', () => {
    expect(isReactiveCompactEligibleError(new Error('HTTP 413: request too large'))).toBe(true)
    expect(
      isReactiveCompactEligibleError(
        new Error("This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens."),
      ),
    ).toBe(true)
    expect(isReactiveCompactEligibleError(new Error('API Error: 400 prompt is too long: 214528 tokens'))).toBe(true)
  })

  it('does not match auth or rate-limit failures', () => {
    expect(isReactiveCompactEligibleError(new Error('HTTP 401: unauthorized'))).toBe(false)
    expect(isReactiveCompactEligibleError(new Error('API Error: 429 rate limit exceeded'))).toBe(false)
    expect(isReactiveCompactEligibleError(new Error('authentication failed'))).toBe(false)
  })

  it('returns false for unrelated errors or empty values', () => {
    expect(isReactiveCompactEligibleError(new Error('tool failed'))).toBe(false)
    expect(isReactiveCompactEligibleError('')).toBe(false)
    expect(isReactiveCompactEligibleError(null)).toBe(false)
  })

  it('classifies common overflow patterns into stable trigger kinds', () => {
    expect(classifyReactiveCompactError(new Error('HTTP 413: request too large'))).toEqual({
      kind: 'http_413',
      detail: 'HTTP 413: request too large',
    })
    expect(classifyReactiveCompactError(new Error('API Error: 400 prompt is too long: 214528 tokens'))).toEqual({
      kind: 'prompt_too_long',
      detail: 'API Error: 400 prompt is too long: 214528 tokens',
    })
    expect(
      classifyReactiveCompactError(
        new Error("This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens."),
      ),
    ).toEqual({
      kind: 'maximum_context_length',
      detail:
        "This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens.",
    })
  })
})
