import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders structured markdown with code block controls', () => {
    const { container } = render(<MarkdownRenderer text={'# Title\n\n```ts\nconst done = true\n```'} />)

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
    expect(container.querySelector('.codex-md-code-body code')?.textContent).toBe('const done = true')
  })

  it('routes file citation clicks through onOpenFile', () => {
    const onOpenFile = vi.fn()
    render(<MarkdownRenderer text='See [guide](./docs/guide.md:3)' onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByRole('button', { name: 'guide (line 3)' }))

    expect(onOpenFile).toHaveBeenCalledWith({
      path: './docs/guide.md',
      label: 'guide',
      line: 3,
      endLine: undefined,
    })
  })

  it('keeps relative file links clickable when onOpenFile is not provided', () => {
    render(<MarkdownRenderer text='See [guide](./docs/guide.md:3)' />)

    const link = screen.getByRole('link', { name: 'guide (line 3)' })
    expect(link).toHaveAttribute('href', './docs/guide.md:3')
  })

  it('routes external link clicks through onExternalLinkClick', () => {
    const onExternalLinkClick = vi.fn()
    render(<MarkdownRenderer text='Visit [OpenAI](https://openai.com)' onExternalLinkClick={onExternalLinkClick} />)

    fireEvent.click(screen.getByRole('link', { name: 'OpenAI' }))

    expect(onExternalLinkClick).toHaveBeenCalledWith('https://openai.com', expect.any(Object))
  })

  it('does not classify bare host-style links as file citations', () => {
    render(<MarkdownRenderer text='Visit [OpenAI](openai.com)' />)

    const link = screen.getByRole('link', { name: 'OpenAI' })
    expect(link).toHaveAttribute('href', 'openai.com')
  })
})
