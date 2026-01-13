import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './args.js'

describe('parseCliArgs', () => {
  it('extracts flags and keeps positionals', () => {
    const res = parseCliArgs(['config', 'show', '--json', '-h'])
    expect(res.flags.json).toBe(true)
    expect(res.flags.help).toBe(true)
    expect(res.flags.noColor).toBe(false)
    expect(res.flags.bundle).toBe(false)
    expect(res.positionals).toEqual(['config', 'show'])
  })

  it('parses --no-color', () => {
    const res = parseCliArgs(['--no-color'])
    expect(res.flags.noColor).toBe(true)
    expect(res.flags.json).toBe(false)
    expect(res.flags.help).toBe(false)
    expect(res.flags.bundle).toBe(false)
  })

  it('parses --bundle', () => {
    const res = parseCliArgs(['doctor', '--bundle'])
    expect(res.flags.bundle).toBe(true)
    expect(res.flags.json).toBe(false)
    expect(res.positionals).toEqual(['doctor'])
  })
})
