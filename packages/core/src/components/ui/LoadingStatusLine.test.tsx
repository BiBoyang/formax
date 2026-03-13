import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import {
  buildShimmerFrames,
  splitCharsByFrame,
  pickNextRandomIndex,
  LoadingStatusLine,
} from './LoadingStatusLine'

describe('LoadingStatusLine', () => {
  it('buildShimmerFrames matches Cogitating sweep from cast', () => {
    const text = 'Cogitating…'
    const chars = Array.from(text)
    const frames = buildShimmerFrames(chars.length)

    const highlights = frames.map((f) => splitCharsByFrame(chars, f).highlight)

    expect(highlights).toEqual([
      '…',
      'g…',
      'ng…',
      'ing',
      'tin',
      'ati',
      'tat',
      'ita',
      'git',
      'ogi',
      'Cog',
      'Co',
      'C',
      '',
    ])
  })

  it('buildShimmerFrames handles 2-char inputs', () => {
    expect(buildShimmerFrames(2)).toEqual([
      { start: 1, length: 1 },
      { start: 0, length: 2 },
      { start: 0, length: 1 },
      { start: 0, length: 0 },
    ])
  })

  it('buildShimmerFrames handles non-positive and single-char inputs', () => {
    expect(buildShimmerFrames(0)).toEqual([{ start: 0, length: 0 }])
    expect(buildShimmerFrames(-3)).toEqual([{ start: 0, length: 0 }])
    expect(buildShimmerFrames(1)).toEqual([
      { start: 0, length: 1 },
      { start: 0, length: 0 },
    ])
  })

  it('renders text with ellipsis and default esc hint', () => {
    const { lastFrame } = render(<LoadingStatusLine text="Thinking" animate={false} />)
    expect(lastFrame()).toContain('✻')
    expect(lastFrame()).toContain('Thinking…')
    expect(lastFrame()).toContain('esc')
    expect(lastFrame()).toContain('to interrupt')
  })

  it('pickNextRandomIndex avoids immediate repeats', () => {
    const rng = () => 0.1
    expect(pickNextRandomIndex(2, 0, rng)).toBe(1)
  })

  it('pickNextRandomIndex handles empty/single and invalid rng values', () => {
    expect(pickNextRandomIndex(0, null, () => 0.2)).toBe(-1)
    expect(pickNextRandomIndex(1, 0, () => 0.8)).toBe(0)
    expect(pickNextRandomIndex(3, null, () => Number.NaN)).toBe(0)
    expect(pickNextRandomIndex(3, null, () => 9)).toBe(2)
  })

  it('uses provided words list when cycleWords enabled', () => {
    const rng = () => 0
    const { lastFrame } = render(
      <LoadingStatusLine
        text="NotInList"
        cycleWords
        words={['Alpha', 'Beta']}
        rng={rng}
        animate={false}
      />,
    )
    expect(lastFrame()).toContain('Alpha')
    expect(lastFrame()).not.toContain('NotInList')
  })

  it('uses default words when cycleWords enabled without words prop', () => {
    const { lastFrame } = render(<LoadingStatusLine cycleWords animate={false} rng={() => 0} />)
    expect(lastFrame()).toContain('Accomplishing')
  })

  it('normalizes words (trim/remove empty/de-duplicate) before cycling', () => {
    const rng = () => 0
    const { lastFrame } = render(
      <LoadingStatusLine
        cycleWords
        words={['  ', '  Alpha  ', 'Alpha', 'Beta']}
        rng={rng}
        animate={false}
      />,
    )
    expect(lastFrame()).toContain('Alpha')
  })

  it('reconciles out-of-range word index after words/text changes', () => {
    const rng = () => 0
    const ui = render(
      <LoadingStatusLine text="Gamma" cycleWords words={['Alpha', 'Beta', 'Gamma']} rng={rng} animate={false} />,
    )
    expect(ui.lastFrame()).toContain('Gamma')

    ui.rerender(<LoadingStatusLine text="NotInList" cycleWords words={['Alpha', 'Beta']} rng={rng} animate={false} />)
    expect(ui.lastFrame()).not.toContain('NotInList')
  })

  it('advances cycling words on interval when enabled', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any) => {
      cb()
      return 1 as any
    }) as any)
    try {
      let seq = 0
      const rng = () => {
        seq += 1
        return seq % 2 === 0 ? 0.9 : 0.1
      }
      const ui = render(
        <LoadingStatusLine
          cycleWords
          words={['Alpha', 'Beta', 'Gamma']}
          rng={rng}
          wordIntervalMs={20}
          animate={false}
        />,
      )
      ui.rerender(<LoadingStatusLine cycleWords words={['Alpha', 'Beta', 'Gamma']} rng={rng} wordIntervalMs={20} animate={false} />)
      expect(setIntervalSpy).toHaveBeenCalled()
      expect(ui.lastFrame()).toContain('✻')
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('handles animation edge cases for one-frame and multi-frame modes', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any) => {
      cb()
      return 1 as any
    }) as any)
    try {
      const singleFrame = render(<LoadingStatusLine text="" ellipsis={false} animate intervalMs={10} />)
      expect(singleFrame.lastFrame()).toContain('✻')

      const multiFrame = render(<LoadingStatusLine text="Thinking" animate intervalMs={10} />)
      multiFrame.rerender(<LoadingStatusLine text="Thinking" animate intervalMs={10} />)
      expect(setIntervalSpy).toHaveBeenCalled()
      expect(multiFrame.lastFrame()).toContain('✻')
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('renders ellipsis variants and default fallback text', () => {
    const a = render(<LoadingStatusLine text="" ellipsis animate={false} />)
    expect(a.lastFrame()).toContain('…')

    const b = render(<LoadingStatusLine text="Done…" animate={false} />)
    expect(b.lastFrame()).toContain('Done…')

    const c = render(<LoadingStatusLine text="Done..." animate={false} />)
    expect(c.lastFrame()).toContain('Done…')

    const d = render(<LoadingStatusLine text="Done." animate={false} />)
    expect(d.lastFrame()).toContain('Done…')

    const e = render(<LoadingStatusLine text={undefined} animate={false} ellipsis={false} />)
    expect(e.lastFrame()).toContain('Cogitating')
  })

  it('renders without default hint when hidden and supports custom hint', () => {
    const hidden = render(<LoadingStatusLine text="Thinking" animate={false} showHint={false} />)
    expect(hidden.lastFrame()).not.toContain('to interrupt')

    const custom = render(<LoadingStatusLine text="Thinking" animate={false} hint="custom-hint" />)
    expect(custom.lastFrame()).toContain('custom-hint')
  })

  it('skips word interval setup for single word and non-positive interval, and cleans up timers', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any) => {
      cb()
      return 123 as any
    }) as any)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
    try {
      const single = render(<LoadingStatusLine cycleWords words={['Only']} wordIntervalMs={10} animate={false} />)
      expect(setIntervalSpy).not.toHaveBeenCalled()
      single.unmount()

      const disabled = render(<LoadingStatusLine cycleWords words={['A', 'B']} wordIntervalMs={0} animate={false} />)
      expect(setIntervalSpy).not.toHaveBeenCalled()
      disabled.unmount()

      const active = render(<LoadingStatusLine text="Thinking" animate intervalMs={20} />)
      expect(setIntervalSpy).toHaveBeenCalled()
      active.unmount()
      expect(clearIntervalSpy).toHaveBeenCalled()
    } finally {
      clearIntervalSpy.mockRestore()
      setIntervalSpy.mockRestore()
    }
  })
})
