import { describe, expect, it } from 'vitest'
import { truncateUtf8WithMarker } from './truncate'

describe('truncateUtf8WithMarker', () => {
  it('returns empty text when maxBytes <= 0', () => {
    expect(truncateUtf8WithMarker('abc', 0)).toEqual({ text: '', truncated: true })
  })

  it('returns input unchanged when already within byte limit', () => {
    expect(truncateUtf8WithMarker('abc', 3)).toEqual({ text: 'abc', truncated: false })
  })

  it('returns truncated marker prefix when marker itself exceeds maxBytes', () => {
    const out = truncateUtf8WithMarker('abcdef', 4)
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBeLessThanOrEqual(4)
  })

  it('appends truncation marker when there is room for head + marker', () => {
    const out = truncateUtf8WithMarker('abcdefghijklmnopqrstuvwxyz', 20)
    expect(out.truncated).toBe(true)
    expect(out.text).toContain('(Truncated)')
  })
})
