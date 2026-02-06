import { describe, expect, it } from 'vitest'
import { buildCompactRequest } from './compact'

describe('buildCompactRequest', () => {
  it('builds base compact instructions', () => {
    const prompt = buildCompactRequest('')
    expect(prompt).toContain('Summarize the conversation so far for future context.')
    expect(prompt).toContain('Output only the summary.')
    expect(prompt).not.toContain('Additional user instructions:')
  })

  it('appends additional user instructions', () => {
    const prompt = buildCompactRequest('keep implementation details')
    expect(prompt).toContain('Additional user instructions:')
    expect(prompt).toContain('keep implementation details')
  })
})
