import { describe, expect, it, vi, afterEach } from 'vitest'
import { WebSearchToolHandler } from './handler'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('WebSearchToolHandler', () => {
  it('parses DuckDuckGo HTML results', async () => {
    const html = [
      '<a class="result__a" href="https://example.com">Example &amp; One</a>',
      '<a class="result__snippet" href="https://example.com">Snippet one</a>',
      '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.org%2Ffoo">Example Two</a>',
      '<div class="result__snippet">Snippet two</div>',
    ].join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('Found 2 results')
    expect(result.content).toContain('Example & One')
    expect(result.content).toContain('https://example.com')
    expect(result.content).toContain('Snippet one')
    expect(result.content).toContain('https://example.org/foo')
    expect(result.content).toContain('Snippet two')
  })

  it('filters by allowed_domains', async () => {
    const html = [
      '<a class="result__a" href="https://example.com">Example One</a>',
      '<a class="result__snippet">Snippet one</a>',
      '<a class="result__a" href="https://blocked.com">Blocked</a>',
      '<a class="result__snippet">Nope</a>',
    ].join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      {
        id: '1',
        name: 'WebSearch',
        input: { query: 'test', allowed_domains: ['example.com'] },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('Found 1 results')
    expect(result.content).toContain('https://example.com')
    expect(result.content).not.toContain('blocked.com')
  })
})

