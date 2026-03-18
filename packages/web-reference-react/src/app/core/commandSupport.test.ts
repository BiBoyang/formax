import { describe, expect, it } from 'vitest'
import {
  getWebSupportedSlashCommandSpecs,
  getWebSupportedSlashCommands,
  isWebSupportedCommand,
} from './commandSupport'

describe('commandSupport', () => {
  it('supports only the four allowed slash commands for web', () => {
    expect(getWebSupportedSlashCommands().sort()).toEqual(['/clear', '/compact', '/init', '/todos'])
    expect(isWebSupportedCommand('/init')).toBe(true)
    expect(isWebSupportedCommand('/clear')).toBe(true)
    expect(isWebSupportedCommand('/compact')).toBe(true)
    expect(isWebSupportedCommand('/todos')).toBe(true)
    expect(isWebSupportedCommand('/agents')).toBe(false)
    expect(isWebSupportedCommand('/hooks')).toBe(false)
    expect(isWebSupportedCommand('/permissions')).toBe(false)
    expect(isWebSupportedCommand('/help')).toBe(false)
  })

  it('exposes slash command specs with descriptions in stable order', () => {
    const specs = getWebSupportedSlashCommandSpecs()
    expect(specs.map((spec) => spec.command)).toEqual(['/init', '/clear', '/compact', '/todos'])
    expect(specs.every((spec) => spec.description.length > 0)).toBe(true)
  })
})
