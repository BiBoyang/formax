import { describe, expect, it } from 'vitest'
import { nextReplMode } from './mode'

describe('nextReplMode', () => {
  it('cycles normal -> acceptEdits -> plan -> normal', () => {
    expect(nextReplMode('normal')).toBe('acceptEdits')
    expect(nextReplMode('acceptEdits')).toBe('plan')
    expect(nextReplMode('plan')).toBe('normal')
  })

  it('falls back to normal for unknown values', () => {
    expect(nextReplMode('wat' as any)).toBe('normal')
  })
})

