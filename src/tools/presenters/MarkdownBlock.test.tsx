import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { MarkdownBlock as UiMarkdownBlock } from '../../components/ui/MarkdownBlock'
import { MarkdownBlock as ServiceMarkdownBlock } from './MarkdownBlock'

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('tools/presenters/MarkdownBlock', () => {
  it('renders paragraphs/lists/code and strips fence markers', () => {
    const markdown = ['Hello `world`', '', '- a', '- b', '', '```js', "console.log('hi')", '```'].join('\n')
    const frame = renderFrame(<ServiceMarkdownBlock markdown={markdown} />)

    expect(frame).toContain('Hello')
    expect(frame).toContain('world')
    expect(frame).not.toContain('`')
    expect(frame).toContain('- a')
    expect(frame).toContain('- b')
    expect(frame).toContain("console.log('hi')")
    expect(frame).not.toContain('```')
  })

  it('matches UI MarkdownBlock rendering baseline', () => {
    const markdown = ['Paragraph 1', '', 'Paragraph 2', '', '- item-1', '- item-2', '', '`tail`'].join('\n')
    const serviceFrame = renderFrame(<ServiceMarkdownBlock markdown={markdown} />)
    const uiFrame = renderFrame(<UiMarkdownBlock markdown={markdown} />)

    expect(serviceFrame).toBe(uiFrame)
  })
})
