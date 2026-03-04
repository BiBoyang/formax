import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('../app/core/markdownShikiRuntime', () => ({
  createMarkdownShikiRuntime: vi.fn(async () => ({
    normalizeLanguage: (raw: string | undefined) => {
      const normalized = (raw ?? '').trim().toLowerCase()
      if (!normalized) return 'text'
      if (normalized === 'js') return 'javascript'
      return normalized
    },
    ensureLanguageLoaded: vi.fn(async () => undefined),
    highlighter: {
      codeToHtml: (code: string, options: { lang: string }) =>
        `<pre><code class="language-${options.lang}">${code}</code></pre>`,
    },
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

  it('prefers worker rendering path when Worker is available', async () => {
    const originalRic = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback
    const originalCic = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback
    const originalWorker = (window as Window & { Worker?: unknown }).Worker

    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline)
      return 1
    })
    const cancelIdleCallback = vi.fn()

    let shouldFailWorkerRender = false
    class MockWorker {
      onmessage: ((event: MessageEvent<{ id: number; ok: boolean; html?: string; error?: string }>) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      terminate = vi.fn()

      postMessage(payload: unknown) {
        const id = (payload as { id?: unknown } | null)?.id
        if (typeof id !== 'number') return
        if (shouldFailWorkerRender) {
          this.onmessage?.({
            data: {
              id,
              ok: false,
              error: 'worker_render_failed',
            },
          } as MessageEvent<{ id: number; ok: boolean; error: string }>)
          return
        }
        this.onmessage?.({
          data: {
            id,
            ok: true,
            html: '<div data-component="markdown-code"><pre><code>worker-code</code></pre><button type="button" data-copy-code aria-label="Copy code" title="Copy code">Copy</button></div>',
          },
        } as MessageEvent<{ id: number; ok: boolean; html: string }>)
      }
    }

    const workerCtor = vi.fn(() => new MockWorker())

    ;(window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number }).requestIdleCallback = requestIdleCallback
    ;(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = cancelIdleCallback
    ;(window as Window & { Worker?: unknown }).Worker = workerCtor as unknown as typeof Worker

    try {
      const cacheKey = `markdown-worker-${Math.random().toString(36).slice(2)}`
      const markdown = '```js\nconsole.log(\"worker\")\n```'

      const view = render(<MarkdownRenderer text={markdown} cacheKey={cacheKey} />)
      await waitFor(() => {
        expect(workerCtor).toHaveBeenCalledTimes(1)
        expect(view.container.querySelector('[data-copy-code]')).not.toBeNull()
      })
      view.unmount()

      shouldFailWorkerRender = true
      const fallbackCacheKey = `markdown-worker-fallback-${Math.random().toString(36).slice(2)}`
      const fallbackView = render(<MarkdownRenderer text={markdown} cacheKey={fallbackCacheKey} />)
      await waitFor(() => {
        expect(fallbackView.container.querySelector('[data-copy-code]')).not.toBeNull()
        expect(fallbackView.container.querySelector('code.language-javascript')).not.toBeNull()
      })
      expect(workerCtor).toHaveBeenCalledTimes(1)
      fallbackView.unmount()
    } finally {
      ;(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = originalRic
      ;(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCic
      ;(window as Window & { Worker?: unknown }).Worker = originalWorker
    }
  })
})
