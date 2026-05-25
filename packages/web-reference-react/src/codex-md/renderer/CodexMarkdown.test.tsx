import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexMarkdown } from './CodexMarkdown'

describe('CodexMarkdown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies async syntax highlighting after the initial plain-text render', async () => {
    vi.useFakeTimers()

    const highlighter = vi.fn(async (code: string) => ({
      html: `<span class="tok">${code.toUpperCase()}</span>`,
      className: 'hljs language-ts',
    }))

    const { container } = render(<CodexMarkdown highlighter={highlighter} value={'```ts\nconst done = true\n```'} />)

    expect(container.querySelector('.codex-md-code-body code')?.textContent).toBe('const done = true')
    expect(container.querySelector('.tok')).toBeNull()

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container.querySelector('.tok')?.textContent).toBe('CONST DONE = TRUE')
    expect(highlighter).toHaveBeenCalledWith('const done = true', 'ts')
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })
})
