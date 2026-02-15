import { describe, expect, it } from 'vitest'
import { stripDefaultsFromPatch } from './persist'

describe('stripDefaultsFromPatch', () => {
  it('omits default llm.defaultTier (sonnet) from sparse patch', () => {
    const out = stripDefaultsFromPatch({
      version: 1,
      llm: { defaultTier: 'sonnet' },
    })
    expect(out.llm).toBeUndefined()
  })

  it('keeps non-default llm.defaultTier in sparse patch', () => {
    const out = stripDefaultsFromPatch({
      version: 1,
      llm: { defaultTier: 'opus' },
    })
    expect(out.llm?.defaultTier).toBe('opus')
  })
})

