import { describe, expect, it } from 'vitest'
import { truncateByCharBudget } from './charBudget'

describe('truncateByCharBudget', () => {
  it('keeps all lines when under budget', () => {
    const out = truncateByCharBudget(['a', 'bb', 'ccc'], 100)
    expect(out).toEqual({ kept: ['a', 'bb', 'ccc'], truncated: false })
  })

  it('truncates when exceeding budget', () => {
    const out = truncateByCharBudget(['aaaa', 'bbbb', 'cccc'], 10)
    expect(out.truncated).toBe(true)
    expect(out.kept.length).toBeGreaterThanOrEqual(1)
    expect(out.kept.length).toBeLessThan(3)
  })

  it('treats non-finite budget as 0', () => {
    expect(truncateByCharBudget(['x'], Number.NaN)).toEqual({ kept: [], truncated: true })
  })
})

