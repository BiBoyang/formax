import { describe, expect, it } from 'vitest'
import { hookMatcherMatchesToolName } from './matcher.js'

describe('hookMatcherMatchesToolName', () => {
  it('matches all tools for blank or * matcher', () => {
    expect(hookMatcherMatchesToolName({ matcher: '', toolName: 'Bash' })).toBe(true)
    expect(hookMatcherMatchesToolName({ matcher: '*', toolName: 'Read' })).toBe(true)
    expect(hookMatcherMatchesToolName({ matcher: undefined, toolName: 'Write' })).toBe(true)
  })

  it('treats simple matchers as exact match', () => {
    expect(hookMatcherMatchesToolName({ matcher: 'Bash', toolName: 'Bash' })).toBe(true)
    expect(hookMatcherMatchesToolName({ matcher: 'Bash', toolName: 'Read' })).toBe(false)
  })

  it('treats non-simple matchers as regex (invalid regex -> non-match)', () => {
    expect(hookMatcherMatchesToolName({ matcher: 'Edit|Write', toolName: 'Write' })).toBe(true)
    expect(hookMatcherMatchesToolName({ matcher: 'Edit|Write', toolName: 'Read' })).toBe(false)
    expect(hookMatcherMatchesToolName({ matcher: '([', toolName: 'Bash' })).toBe(false)
  })
})

