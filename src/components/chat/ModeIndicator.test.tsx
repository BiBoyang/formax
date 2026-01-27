import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ModeIndicator } from './ModeIndicator'

describe('ModeIndicator', () => {
  it('renders normal mode', () => {
    const { lastFrame } = render(<ModeIndicator mode="normal" />)
    const frame = lastFrame() || ''
    expect(frame).toContain('⏺ normal')
    expect(frame).toContain('(shift+tab to cycle)')
  })

  it('renders accept edits mode', () => {
    const { lastFrame } = render(<ModeIndicator mode="acceptEdits" />)
    const frame = lastFrame() || ''
    expect(frame).toContain('⏵⏵ accept edits on')
    expect(frame).toContain('(shift+tab to cycle)')
  })

  it('renders plan mode', () => {
    const { lastFrame } = render(<ModeIndicator mode="plan" />)
    const frame = lastFrame() || ''
    expect(frame).toContain('⏸ plan mode on')
    expect(frame).toContain('(shift+tab to cycle)')
  })
})

