import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('shiki', () => ({
  bundledLanguages: {
    text: {},
    javascript: {},
  },
  createHighlighter: vi.fn(async () => ({
    getLoadedLanguages: () => ['text', 'javascript'],
    loadLanguage: vi.fn(async () => undefined),
    codeToHtml: (code: string, options: { lang: string }) =>
      `<pre><code class="language-${options.lang}">${code}</code></pre>`,
  })),
}))

describe('MarkdownRenderer', () => {
  it('schedules code highlighting via idle callback and reuses highlighted cache', async () => {
    const originalRic = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback
    const originalCic = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline)
      return 1
    })
    const cancelIdleCallback = vi.fn()

    ;(window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number }).requestIdleCallback = requestIdleCallback
    ;(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = cancelIdleCallback

    try {
      const cacheKey = `markdown-idle-${Math.random().toString(36).slice(2)}`
      const markdown = '```js\nconst answer = 42\n```'

      const first = render(<MarkdownRenderer text={markdown} cacheKey={cacheKey} />)
      await waitFor(() => {
        expect(requestIdleCallback).toHaveBeenCalledTimes(1)
        expect(first.container.querySelector('[data-copy-code]')).not.toBeNull()
      })
      first.unmount()

      const second = render(<MarkdownRenderer text={markdown} cacheKey={cacheKey} />)
      await waitFor(() => {
        expect(second.container.querySelector('[data-copy-code]')).not.toBeNull()
      })
      expect(requestIdleCallback).toHaveBeenCalledTimes(1)
      second.unmount()
    } finally {
      ;(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = originalRic
      ;(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCic
    }
  })
})
