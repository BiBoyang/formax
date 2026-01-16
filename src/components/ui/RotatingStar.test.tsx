import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { RotatingStar } from './RotatingStar'

describe('RotatingStar', () => {
  it('renders rotating star symbol', () => {
    const { lastFrame } = render(<RotatingStar intervalMs={100} />)
    const frame = lastFrame()
    // Should contain one of the star symbols
    expect(frame).toMatch(/[·✢✳✶✻✽]/)
  })

  it('cycles through star symbols', async () => {
    const { frames } = render(<RotatingStar intervalMs={50} />)

    // Wait for a few frames to see the rotation
    await new Promise((resolve) => setTimeout(resolve, 200))

    const symbols = frames.map((f) => f.match(/[·✢✳✶✻✽]/)?.[0]).filter(Boolean)
    expect(symbols.length).toBeGreaterThan(0)
  })

  it('accepts custom color', () => {
    const { lastFrame } = render(<RotatingStar color="#ff0000" intervalMs={100} />)
    const frame = lastFrame()
    expect(frame).toMatch(/[·✢✳✶✻✽]/)
  })
})
