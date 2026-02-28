import { describe, expect, it } from 'vitest'
import { clamp, formatMatcherLabel, formatSourceLabel, groupHookEntriesByMatcher } from './utils.js'

describe('ui/hooks/utils', () => {
  describe('clamp', () => {
    it('clamps NaN to min', () => {
      expect(clamp(Number.NaN, 1, 3)).toBe(1)
    })

    it('clamps below min', () => {
      expect(clamp(0, 1, 3)).toBe(1)
    })

    it('clamps above max', () => {
      expect(clamp(4, 1, 3)).toBe(3)
    })

    it('passes through in-range', () => {
      expect(clamp(2, 1, 3)).toBe(2)
    })
  })

  describe('formatMatcherLabel', () => {
    it('trims whitespace', () => {
      expect(formatMatcherLabel('  Bash(ls:*)  ')).toBe('Bash(ls:*)')
    })

    it('keeps wildcard matcher as-is', () => {
      expect(formatMatcherLabel(' * ')).toBe('*')
    })

    it('treats empty string as empty label', () => {
      expect(formatMatcherLabel('   ')).toBe('')
    })

    it('treats missing matcher as empty label', () => {
      expect(formatMatcherLabel(undefined as any)).toBe('')
    })
  })

  describe('formatSourceLabel', () => {
    it('formats known sources', () => {
      expect(formatSourceLabel('projectLocal')).toBe('Local Settings')
      expect(formatSourceLabel('project')).toBe('Project Settings')
      expect(formatSourceLabel('user')).toBe('User Settings')
    })

    it('formats unknown sources', () => {
      expect(formatSourceLabel('something-else' as any)).toBe('Unknown Settings')
    })
  })

  describe('groupHookEntriesByMatcher', () => {
    it('groups entries by matcher and preserves first-seen order', () => {
      const entries = [
        { source: 'user', matcher: 'Bash(ls:*)', command: 'a', timeoutMs: null },
        { source: 'user', matcher: '*', command: 'b', timeoutMs: null },
        { source: 'project', matcher: 'Bash(ls:*)', command: 'c', timeoutMs: null },
        { source: 'project', matcher: undefined, command: 'x', timeoutMs: null },
        { source: 'projectLocal', matcher: '', command: 'd', timeoutMs: null },
      ] as const

      const groups = groupHookEntriesByMatcher(entries as any)
      expect(groups.map((g) => g.matcher)).toEqual(['Bash(ls:*)', '*', ''])
      expect(groups[0]?.entries.map((e) => e.command)).toEqual(['a', 'c'])
      expect(groups[1]?.entries.map((e) => e.command)).toEqual(['b'])
      expect(groups[2]?.entries.map((e) => e.command)).toEqual(['x', 'd'])
    })
  })
})
