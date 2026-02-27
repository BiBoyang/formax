import { describe, expect, it } from 'vitest'
import { stripCatNPrefixes } from './catN'

describe('stripCatNPrefixes', () => {
  it('strips cat -n style prefixes across tab/arrow/spaces', () => {
    const input = ['   1\talpha', '2→beta', '    3    gamma', 'plain'].join('\n')
    expect(stripCatNPrefixes(input)).toBe(['alpha', 'beta', 'gamma', 'plain'].join('\n'))
  })

  it('returns an empty string for nullish input', () => {
    expect(stripCatNPrefixes(undefined)).toBe('')
    expect(stripCatNPrefixes(null)).toBe('')
  })
})
