import { describe, expect, it } from 'vitest'
import { toolSearchToolSpec } from './spec'

describe('toolSearchToolSpec', () => {
  it('keeps hard-requirement deferred-loading guidance copy', () => {
    const description = toolSearchToolSpec.description
    expect(description).toContain('MANDATORY PREREQUISITE - THIS IS A HARD REQUIREMENT')
    expect(description).toContain('Both modes load tools equally')
    expect(description).toContain('INCORRECT Usage Patterns - NEVER DO THESE:')
    expect(description).toContain('select:<tool_name>')
  })
})
