import { describe, expect, it } from 'vitest'
import { isReplMode, normalizeReplMode, resolveReplModeTransition } from './replModeTransition.js'

describe('replModeTransition', () => {
  it('validates repl modes', () => {
    expect(isReplMode('normal')).toBe(true)
    expect(isReplMode('acceptEdits')).toBe(true)
    expect(isReplMode('plan')).toBe(true)
    expect(isReplMode('unknown')).toBe(false)
    expect(isReplMode(null)).toBe(false)
  })

  it('normalizes repl mode with fallback', () => {
    expect(normalizeReplMode('plan')).toBe('plan')
    expect(normalizeReplMode('wat')).toBe('normal')
    expect(normalizeReplMode('wat', 'acceptEdits')).toBe('acceptEdits')
  })

  it('produces transition only when target mode changes', () => {
    expect(resolveReplModeTransition({ current: 'normal', next: 'normal' })).toBeNull()
    expect(resolveReplModeTransition({ current: 'normal', next: 'plan' })).toEqual({
      from: 'normal',
      to: 'plan',
    })
  })
})
