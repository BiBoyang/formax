import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { getTheme } from '../../shared/utils/theme'
import { renderThinkingBlock, shouldRenderThinkingBlock } from './thinkingBlock'

describe('thinkingBlock', () => {
  it('shouldRenderThinkingBlock: primary respects verboseOutput', () => {
    expect(shouldRenderThinkingBlock({ mode: 'primary', verboseOutput: false })).toBe(false)
    expect(shouldRenderThinkingBlock({ mode: 'primary', verboseOutput: true })).toBe(true)
  })

  it('shouldRenderThinkingBlock: expanded always renders', () => {
    expect(shouldRenderThinkingBlock({ mode: 'expanded', verboseOutput: false })).toBe(true)
    expect(shouldRenderThinkingBlock({ mode: 'expanded', verboseOutput: true })).toBe(true)
  })

  it('renderThinkingBlock: renders header and content', () => {
    const theme = getTheme()
    const ui = render(<>{renderThinkingBlock({ content: 'line 1\n\nline 3', theme })}</>)
    const out = ui.lastFrame()
    expect(out).toContain('∴ Thinking…')
    expect(out).toContain('line 1')
    expect(out).toContain('line 3')
  })

  it('renderThinkingBlock: handles missing content by rendering header only', () => {
    const theme = getTheme()
    const ui = render(<>{renderThinkingBlock({ content: undefined as any, theme })}</>)
    const out = ui.lastFrame()
    expect(out).toContain('∴ Thinking…')
    expect(out).not.toContain('undefined')
  })
})
