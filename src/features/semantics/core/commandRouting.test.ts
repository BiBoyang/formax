import { describe, expect, it } from 'vitest'
import { isExactSlashCommand, resolveCommandRouting } from './commandRouting.js'

describe('commandRouting', () => {
  it('classifies /init as command-dispatchable', () => {
    const out = resolveCommandRouting('/init')
    expect(out.commandName).toBe('/init')
    expect(out.commandArgs).toBe('')
    expect(out.isSlashCommand).toBe(true)
    expect(out.shouldUseCommandDispatch).toBe(true)
  })

  it('classifies /todos as command-dispatchable', () => {
    const out = resolveCommandRouting('/todos')
    expect(out.commandName).toBe('/todos')
    expect(out.commandArgs).toBe('')
    expect(out.isSlashCommand).toBe(true)
    expect(out.shouldUseCommandDispatch).toBe(true)
  })

  it('classifies /compact as command-dispatchable', () => {
    const out = resolveCommandRouting('/compact summarize recent edits')
    expect(out.commandName).toBe('/compact')
    expect(out.commandArgs).toBe('summarize recent edits')
    expect(out.isSlashCommand).toBe(true)
    expect(out.shouldUseCommandDispatch).toBe(true)
  })

  it('keeps unknown slash commands on turn/start route', () => {
    const out = resolveCommandRouting('/permissions')
    expect(out.commandName).toBe('/permissions')
    expect(out.commandArgs).toBe('')
    expect(out.shouldUseCommandDispatch).toBe(false)
  })

  it('extracts slash command args', () => {
    const out = resolveCommandRouting('/clear keep')
    expect(out.commandName).toBe('/clear')
    expect(out.commandArgs).toBe('keep')
  })

  it('matches exact slash commands with optional args', () => {
    expect(isExactSlashCommand('/compact', '/compact')).toBe(true)
    expect(isExactSlashCommand('/compact summarize recent edits', '/compact')).toBe(true)
    expect(isExactSlashCommand('/compactly', '/compact')).toBe(false)
  })

  it('recognizes exact slash commands with leading spaces', () => {
    expect(isExactSlashCommand('   /clear', '/clear')).toBe(true)
  })

  it('handles non-slash and missing input safely', () => {
    const out = resolveCommandRouting(undefined as any)
    expect(out.rawText).toBe('')
    expect(out.commandName).toBeNull()
    expect(out.commandArgs).toBeNull()
    expect(out.isSlashCommand).toBe(false)
    expect(out.isSlashCommandAfterTrim).toBe(false)
    expect(out.shouldUseCommandDispatch).toBe(false)
  })

  it('returns false when exact command matching preconditions are not met', () => {
    expect(isExactSlashCommand('hello', '/clear')).toBe(false)
    expect(isExactSlashCommand('/clear', 'clear')).toBe(false)
    expect(isExactSlashCommand('/clear', '')).toBe(false)
  })
})
