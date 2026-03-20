import { describe, expect, it } from 'vitest'
import { shouldTreatAsLongPrompt } from './userSettings'

describe('shouldTreatAsLongPrompt', () => {
  it('returns false for short single-line prompts', () => {
    expect(shouldTreatAsLongPrompt('short prompt')).toBe(false)
    expect(shouldTreatAsLongPrompt('a'.repeat(119))).toBe(false)
  })

  it('returns true when trimmed text reaches the length threshold', () => {
    expect(shouldTreatAsLongPrompt(`   ${'a'.repeat(120)}   `)).toBe(true)
  })

  it('returns true for multi-line prompts regardless of length', () => {
    expect(shouldTreatAsLongPrompt('line 1\nline 2')).toBe(true)
  })
})
