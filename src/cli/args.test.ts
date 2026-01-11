import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './args.js'

describe('parseCliArgs', () => {
  it('extracts flags and keeps positionals', () => {
    const res = parseCliArgs(['config', 'show', '--json', '-h'])
    expect(res.flags.json).toBe(true)
    expect(res.flags.help).toBe(true)
    expect(res.positionals).toEqual(['config', 'show'])
  })
})

