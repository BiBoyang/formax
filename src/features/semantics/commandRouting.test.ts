import { describe, expect, it } from 'vitest'
import { isExactSlashCommand, resolveCommandRouting } from './commandRouting.js'

describe('commandRouting', () => {
  it('classifies /init as command-dispatchable', () => {
    const out = resolveCommandRouting('/init')
    expect(out.commandName).toBe('/init')
    expect(out.isSlashCommand).toBe(true)
    expect(out.shouldUseCommandDispatch).toBe(true)
  })

  it('keeps unknown slash commands on turn/start route', () => {
    const out = resolveCommandRouting('/permissions')
    expect(out.commandName).toBe('/permissions')
    expect(out.shouldUseCommandDispatch).toBe(false)
  })

  it('matches exact slash commands with optional args', () => {
    expect(isExactSlashCommand('/compact', '/compact')).toBe(true)
    expect(isExactSlashCommand('/compact summarize recent edits', '/compact')).toBe(true)
    expect(isExactSlashCommand('/compactly', '/compact')).toBe(false)
  })

  it('recognizes exact slash commands with leading spaces', () => {
    expect(isExactSlashCommand('   /clear', '/clear')).toBe(true)
  })
})
