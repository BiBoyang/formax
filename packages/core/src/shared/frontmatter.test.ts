import { describe, expect, it } from 'vitest'
import { extractFirstMeaningfulLine, parseMarkdownFrontmatter } from './frontmatter'

describe('parseMarkdownFrontmatter', () => {
  it('returns null when no frontmatter exists', () => {
    expect(parseMarkdownFrontmatter('# hi')).toBeNull()
  })

  it('parses attributes and body', () => {
    const raw = [
      '---',
      'description: "Hello world"',
      'argument-hint: [PROMISE="DONE"]',
      '# comment',
      '---',
      '',
      '# Title',
      '',
      'Body line',
      '',
    ].join('\n')

    const parsed = parseMarkdownFrontmatter(raw)
    expect(parsed?.attributes.description).toBe('Hello world')
    expect(parsed?.attributes['argument-hint']).toBe('[PROMISE="DONE"]')
    expect(parsed?.body).toContain('# Title')
    expect(parsed?.body).toContain('Body line')
  })

  it('handles CRLF input', () => {
    const raw = ['---', 'description: hi', '---', '', 'hello'].join('\r\n')
    const parsed = parseMarkdownFrontmatter(raw)
    expect(parsed?.attributes.description).toBe('hi')
    expect(parsed?.body.trim()).toBe('hello')
  })

  it('returns null for malformed frontmatter blocks', () => {
    expect(parseMarkdownFrontmatter('---\nkey: value\nno-end')).toBeNull()
    expect(parseMarkdownFrontmatter(undefined as any)).toBeNull()
  })

  it('ignores invalid header lines and keeps valid quoted values', () => {
    const raw = [
      '---',
      'no-colon-line',
      ': empty-key',
      "title: 'Single quoted title'",
      '---',
      '',
      'content',
    ].join('\n')
    const parsed = parseMarkdownFrontmatter(raw)
    expect(parsed?.attributes).toEqual({ title: 'Single quoted title' })
    expect(parsed?.body).toBe('content')
  })
})

describe('extractFirstMeaningfulLine', () => {
  it('extracts first non-empty line and strips markdown headings', () => {
    expect(extractFirstMeaningfulLine('\n\n# Hello\nWorld')).toBe('Hello')
  })

  it('strips list prefixes', () => {
    expect(extractFirstMeaningfulLine('\n- Item one\n- Item two')).toBe('Item one')
    expect(extractFirstMeaningfulLine('\n* Item one\n* Item two')).toBe('Item one')
  })

  it('returns empty string for empty markdown and truncates long lines', () => {
    expect(extractFirstMeaningfulLine(' \n\t \n')).toBe('')
    expect(extractFirstMeaningfulLine(undefined as any)).toBe('')
    expect(extractFirstMeaningfulLine(`# ${'x'.repeat(120)}`)).toBe('x'.repeat(80))
  })
})
