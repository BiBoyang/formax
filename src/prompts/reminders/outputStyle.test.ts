import { describe, expect, it } from 'vitest'
import { buildOutputStyleInjectedBlocks } from './outputStyle'

describe('buildOutputStyleInjectedBlocks', () => {
  it('returns explanatory reminder block', () => {
    const out = buildOutputStyleInjectedBlocks('explanatory')
    expect(out).toHaveLength(1)
    expect((out[0] as any).text).toContain('Explanatory output style is active')
    expect((out[0] as any).cache_control).toEqual({ type: 'ephemeral' })
  })

  it('returns learning reminder block', () => {
    const out = buildOutputStyleInjectedBlocks('learning')
    expect(out).toHaveLength(1)
    expect((out[0] as any).text).toContain('Learning output style is active')
  })

  it('returns no blocks for default output style', () => {
    expect(buildOutputStyleInjectedBlocks('default')).toEqual([])
  })
})
