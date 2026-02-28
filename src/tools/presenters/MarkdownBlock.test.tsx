import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { MarkdownBlock as UiMarkdownBlock } from '../../components/ui/MarkdownBlock'
import { MarkdownBlock as ServiceMarkdownBlock, parseMarkdown } from './MarkdownBlock'

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

  it('treats unmatched inline backticks as plain text', () => {
    const frame = renderFrame(<ServiceMarkdownBlock markdown={'prefix `unfinished'} />)
    expect(frame).toContain('prefix `unfinished')
  })

  it('renders empty code lines as visible blank rows', () => {
    const md = ['```', 'line-1', '', 'line-3', '```'].join('\n')
    const frame = renderFrame(<ServiceMarkdownBlock markdown={md} />)
    expect(frame).toContain('line-1')
    expect(frame).toContain('line-3')
  })

  it('parseMarkdown normalizes mixed blocks and trims outer blanks', () => {
    const blocks = parseMarkdown(['', '', 'Para', '', '- item', '```', 'code', '```', '', ''].join('\n'))
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['Para'] },
      { kind: 'blank' },
      { kind: 'list', items: ['item'] },
      { kind: 'code', lines: ['code'] },
    ])
  })

  it('parseMarkdown handles unmatched code fence as code until end', () => {
    const blocks = parseMarkdown(['```ts', 'const x = 1'].join('\n'))
    expect(blocks).toEqual([{ kind: 'code', lines: ['const x = 1'] }])
  })

  it('parseMarkdown stops paragraph when code fence begins', () => {
    const blocks = parseMarkdown(['para', '```', 'code', '```'].join('\n'))
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['para'] },
      { kind: 'code', lines: ['code'] },
    ])
  })

  it('parseMarkdown stops paragraph when list begins', () => {
    const blocks = parseMarkdown(['para', '- item'].join('\n'))
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['para'] },
      { kind: 'list', items: ['item'] },
    ])
  })
})
