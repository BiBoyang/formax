import { describe, expect, it } from 'vitest'
import { getWebSupportedSlashCommands, isWebSupportedCommand } from './commandSupport'

describe('commandSupport', () => {
  it('supports only the four allowed slash commands for web', () => {
    expect(getWebSupportedSlashCommands().sort()).toEqual(['/clear', '/compact', '/init', '/todos'])
    expect(isWebSupportedCommand('/init')).toBe(true)
    expect(isWebSupportedCommand('/clear')).toBe(true)
    expect(isWebSupportedCommand('/compact')).toBe(true)
    expect(isWebSupportedCommand('/todos')).toBe(true)
    expect(isWebSupportedCommand('/permissions')).toBe(false)
    expect(isWebSupportedCommand('/help')).toBe(false)
  })
})
