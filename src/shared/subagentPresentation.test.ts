import { describe, expect, it } from 'vitest'
import {
  formatSubagentDisplayName,
  normalizeSubagentLookupKey,
  resolveSubagentColor,
} from './subagentPresentation'

describe('subagentPresentation', () => {
  it('formats kebab/snake names to readable PascalCase', () => {
    expect(formatSubagentDisplayName('code-reviewer')).toBe('CodeReviewer')
    expect(formatSubagentDisplayName('int_code-reviewer')).toBe('IntCodeReviewer')
    expect(formatSubagentDisplayName('Explore')).toBe('Explore')
  })

  it('falls back to Task for missing values', () => {
    expect(formatSubagentDisplayName('')).toBe('Task')
    expect(formatSubagentDisplayName(undefined)).toBe('Task')
    expect(formatSubagentDisplayName('   ')).toBe('Task')
  })

  it('normalizes lookup keys', () => {
    expect(normalizeSubagentLookupKey(' Code-Reviewer ')).toBe('code-reviewer')
    expect(normalizeSubagentLookupKey(undefined)).toBe('')
  })

  it('resolves named and hex colors', () => {
    expect(resolveSubagentColor('blue')).toBe('#0a84ff')
    expect(resolveSubagentColor('#ABC')).toBe('#abc')
    expect(resolveSubagentColor('#12abef')).toBe('#12abef')
    expect(resolveSubagentColor('nope')).toBeNull()
    expect(resolveSubagentColor('')).toBeNull()
  })
})
