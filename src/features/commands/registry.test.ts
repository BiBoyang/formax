import { describe, it, expect } from 'vitest'
import { getSlashCommandSuggestions } from './registry'

describe('getSlashCommandSuggestions', () => {
  it('returns empty when not a slash command', () => {
    expect(getSlashCommandSuggestions('hello')).toEqual([])
  })

  it('returns all commands when only slash is provided', () => {
    const res = getSlashCommandSuggestions('/')
    expect(res.length).toBeGreaterThan(0)
  })

  it('filters by prefix', () => {
    const res = getSlashCommandSuggestions('/ta')
    expect(res.some((c) => c.command === '/tasks')).toBe(true)
  })
})

