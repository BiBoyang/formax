import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareMarkdownRender,
  renderHighlightedMarkdown,
  resetMarkdownServiceForTests,
  touchMarkdownCache,
} from './markdownService'

vi.mock('./markdownShikiRuntime', () => ({
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

describe('markdownService', () => {
  beforeEach(() => {
    resetMarkdownServiceForTests()
  })

  it('reuses cached highlighted html when hash and key match', () => {
    const first = prepareMarkdownRender({ text: 'hello', cacheKey: 'cache-key' })
    touchMarkdownCache(first.key, {
      hash: first.hash,
      sourceText: 'hello',
      baseHtml: first.safeBaseHtml,
      highlightedHtml: '<p>highlighted</p>',
    })

    const second = prepareMarkdownRender({ text: 'hello', cacheKey: 'cache-key' })

    expect(second.cached).not.toBeNull()
    expect(second.initialHtml).toBe('<p>highlighted</p>')
  })

  it('reuses hash-matched cache entry across different cache keys', () => {
    const first = prepareMarkdownRender({ text: '```js\nconst x = 1\n```', cacheKey: 'cache-key-a' })
    touchMarkdownCache(first.key, {
      hash: first.hash,
      sourceText: '```js\nconst x = 1\n```',
      baseHtml: first.safeBaseHtml,
      highlightedHtml: '<p>highlighted-by-hash</p>',
      rawHtml: first.rawHtml,
      hasCodeBlocks: first.hasCodeBlocks,
    })

    const second = prepareMarkdownRender({ text: '```js\nconst x = 1\n```', cacheKey: 'cache-key-b' })

    expect(second.cached).not.toBeNull()
    expect(second.initialHtml).toBe('<p>highlighted-by-hash</p>')
    expect(second.rawHtml).toBe(first.rawHtml)
    expect(second.hasCodeBlocks).toBe(true)
  })

  it('falls back to main-thread highlighting when worker errors', async () => {
    const originalWorker = (window as Window & { Worker?: unknown }).Worker

    class FailingWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      terminate = vi.fn()

      postMessage(_payload: unknown) {
        this.onerror?.(new Event('error'))
      }
    }

    ;(window as Window & { Worker?: unknown }).Worker = vi.fn(() => new FailingWorker()) as unknown as typeof Worker

    try {
      const text = '```js\nconst answer = 42\n```'
      const prepared = prepareMarkdownRender({ text, cacheKey: 'worker-fallback' })
      const highlighted = await renderHighlightedMarkdown({ text, rawHtml: prepared.rawHtml })

      expect(highlighted).toContain('data-component="markdown-code"')
      expect(highlighted).toContain('language-javascript')
    } finally {
      ;(window as Window & { Worker?: unknown }).Worker = originalWorker
      resetMarkdownServiceForTests()
    }
  })

  it('throws worker_aborted when signal is already aborted', async () => {
    const originalWorker = (window as Window & { Worker?: unknown }).Worker

    class PassiveWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      terminate = vi.fn()

      postMessage(_payload: unknown) {
        return undefined
      }
    }

    ;(window as Window & { Worker?: unknown }).Worker = vi.fn(() => new PassiveWorker()) as unknown as typeof Worker

    try {
      const text = '```js\nconst answer = 42\n```'
      const prepared = prepareMarkdownRender({ text, cacheKey: 'worker-abort' })
      const abortController = new AbortController()
      abortController.abort()

      await expect(
        renderHighlightedMarkdown({ text, rawHtml: prepared.rawHtml, signal: abortController.signal }),
      ).rejects.toThrow('worker_aborted')
    } finally {
      ;(window as Window & { Worker?: unknown }).Worker = originalWorker
      resetMarkdownServiceForTests()
    }
  })
})
