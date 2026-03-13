import { describe, expect, it } from 'vitest'
import { estimatePromptTokens } from './estimate'

describe('estimatePromptTokens', () => {
  it('returns a stable, non-negative estimate', () => {
    const a = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })
    const b = estimatePromptTokens({
      system: [{ type: 'text', text: 'system' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })

    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBe(b)
  })
})

