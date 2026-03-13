import { describe, expect, it } from 'vitest'
import { resolveTurnProvider } from './provider'

describe('resolveTurnProvider', () => {
  it('accepts anthropic', () => {
    expect(resolveTurnProvider('anthropic')).toBe('anthropic')
  })

  it('accepts openai', () => {
    expect(resolveTurnProvider('openai')).toBe('openai')
  })

  it('throws for unsupported providers', () => {
    expect(() => resolveTurnProvider('gemini')).toThrow(/unsupported provider/i)
  })
})

