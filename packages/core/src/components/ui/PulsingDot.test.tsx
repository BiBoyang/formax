import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { dimHexColor, PulsingDot } from './PulsingDot'

describe('dimHexColor', () => {
  it('returns null for invalid hex input', () => {
    expect(dimHexColor('', 1)).toBeNull()
    expect(dimHexColor('not-hex', 0.5)).toBeNull()
    expect(dimHexColor('#12', 0.5)).toBeNull()
  })

  it('dims 6-digit hex and clamps factors', () => {
    expect(dimHexColor('#ffffff', 0.5)).toBe('#808080')
    expect(dimHexColor('#ffffff', -10)).toBe('#000000')
    expect(dimHexColor('#ffffff', 2)).toBe('#ffffff')
    expect(dimHexColor('#ffffff', Number.NaN)).toBe('#ffffff')
  })

  it('expands 3-digit hex format', () => {
    expect(dimHexColor('#abc', 1)).toBe('#aabbcc')
  })
})

describe('PulsingDot', () => {
  it('renders with trailing space by default and can disable it', () => {
    const withSpace = render(<PulsingDot />)
    expect(withSpace.lastFrame()).toContain('⏺')

    const withoutSpace = render(<PulsingDot trailingSpace={false} />)
    expect(withoutSpace.lastFrame()).toContain('⏺')
  })

  it('sets interval only when pulse=true and cleans up timer', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any) => {
      cb()
      return 77 as any
    }) as any)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})

    try {
      const off = render(<PulsingDot pulse={false} />)
      expect(setIntervalSpy).not.toHaveBeenCalled()
      off.unmount()

      const on = render(<PulsingDot pulse intervalMs={10} color="#ffffff" />)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      on.unmount()
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    } finally {
      clearIntervalSpy.mockRestore()
      setIntervalSpy.mockRestore()
    }
  })

  it('falls back to raw color when dimming cannot parse color', () => {
    const ui = render(<PulsingDot pulse color="not-a-hex" />)
    expect(ui.lastFrame()).toContain('⏺')
  })
})
