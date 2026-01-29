import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { MarkdownBlock } from './MarkdownBlock'

describe('MarkdownBlock', () => {
  it('renders paragraphs and inline code', () => {
    const { lastFrame } = render(<MarkdownBlock markdown={'Hello `world`'} />)
    const frame = lastFrame()
    expect(frame).toContain('Hello')
    expect(frame).toContain('world')
    expect(frame).not.toContain('`')
  })

  it('renders lists', () => {
    const { lastFrame } = render(<MarkdownBlock markdown={'- a\n- b'} />)
    const frame = lastFrame()
    expect(frame).toContain('- a')
    expect(frame).toContain('- b')
  })

  it('renders code fences without the fence markers', () => {
    const md = ['```js', "console.log('hi')", '```'].join('\n')
    const { lastFrame } = render(<MarkdownBlock markdown={md} />)
    const frame = lastFrame()
    expect(frame).toContain("console.log('hi')")
    expect(frame).not.toContain('```')
  })
})

