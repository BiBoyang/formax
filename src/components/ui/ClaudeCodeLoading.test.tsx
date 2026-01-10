import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import {
  buildClaudeCodeShimmerFrames,
  splitCharsByFrame,
  pickNextRandomIndex,
  ClaudeCodeLoading,
} from './ClaudeCodeLoading'

describe('ClaudeCodeLoading', () => {
  it('buildClaudeCodeShimmerFrames matches Cogitating sweep from cast', () => {
    const text = 'Cogitating…'
    const chars = Array.from(text)
    const frames = buildClaudeCodeShimmerFrames(chars.length)

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

  it('renders text with ellipsis and default esc hint', () => {
    const { lastFrame } = render(<ClaudeCodeLoading text="Thinking" animate={false} />)
    expect(lastFrame()).toContain('✻')
    expect(lastFrame()).toContain('Thinking…')
    expect(lastFrame()).toContain('esc')
    expect(lastFrame()).toContain('to interrupt')
  })

  it('pickNextRandomIndex avoids immediate repeats', () => {
    const rng = () => 0.1
    expect(pickNextRandomIndex(2, 0, rng)).toBe(1)
  })

  it('uses provided words list when cycleWords enabled', () => {
    const rng = () => 0
    const { lastFrame } = render(
      <ClaudeCodeLoading
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
})
