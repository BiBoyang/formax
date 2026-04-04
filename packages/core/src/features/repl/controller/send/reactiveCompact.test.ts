import { describe, expect, it } from 'vitest'
import { isReactiveCompactEligibleError } from './reactiveCompact'

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
})
