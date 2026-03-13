import { describe, expect, it } from 'vitest'
import { normalizeMarkdownCodeLanguage } from './markdownShikiRuntime'

describe('normalizeMarkdownCodeLanguage', () => {
  it('normalizes common aliases used in markdown fences', () => {
    expect(normalizeMarkdownCodeLanguage('js')).toBe('javascript')
    expect(normalizeMarkdownCodeLanguage('ts')).toBe('typescript')
    expect(normalizeMarkdownCodeLanguage('sh')).toBe('bash')
    expect(normalizeMarkdownCodeLanguage('yml')).toBe('yaml')
    expect(normalizeMarkdownCodeLanguage('md')).toBe('markdown')
  })

  it('falls back to text for unsupported or blank language labels', () => {
    expect(normalizeMarkdownCodeLanguage('')).toBe('text')
    expect(normalizeMarkdownCodeLanguage(undefined)).toBe('text')
    expect(normalizeMarkdownCodeLanguage('unknown-lang')).toBe('text')
  })
})
