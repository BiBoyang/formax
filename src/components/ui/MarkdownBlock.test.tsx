import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { MarkdownBlock as ServiceMarkdownBlock } from '../../tools/presenters/MarkdownBlock'
import { MarkdownBlock as UiMarkdownBlock } from './MarkdownBlock'

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('components/ui/MarkdownBlock', () => {
  it('renders paragraphs and inline code', () => {
    const frame = renderFrame(<UiMarkdownBlock markdown={'Hello `world`'} />)
    expect(frame).toContain('Hello')
    expect(frame).toContain('world')
    expect(frame).not.toContain('`')
  })

  it('renders lists', () => {
    const frame = renderFrame(<UiMarkdownBlock markdown={'- a\n- b'} />)
    expect(frame).toContain('- a')
    expect(frame).toContain('- b')
  })

  it('renders code fences without the fence markers', () => {
    const md = ['```js', "console.log('hi')", '```'].join('\n')
    const frame = renderFrame(<UiMarkdownBlock markdown={md} />)
    expect(frame).toContain("console.log('hi')")
    expect(frame).not.toContain('```')
  })

  it('matches service MarkdownBlock rendering baseline', () => {
    const md = ['Paragraph 1', '', '- item-1', '- item-2', '', '```txt', 'code line', '```', '', '`tail`'].join('\n')
    const uiFrame = renderFrame(<UiMarkdownBlock markdown={md} />)
    const serviceFrame = renderFrame(<ServiceMarkdownBlock markdown={md} />)

    expect(uiFrame).toBe(serviceFrame)
  })
})
