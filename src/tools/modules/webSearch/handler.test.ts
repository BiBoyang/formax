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

  it('filters by blocked_domains (blocked wins over allowed)', async () => {
    const html = [
      '<a class="result__a" href="https://example.com">Example One</a>',
      '<div class="result__snippet">Snippet one</div>',
      '<a class="result__a" href="https://sub.blocked.com">Blocked</a>',
      '<div class="result__snippet">Nope</div>',
    ].join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      {
        id: '1',
        name: 'WebSearch',
        input: {
          query: 'test',
          allowed_domains: ['example.com', 'blocked.com'],
          blocked_domains: ['blocked.com'],
        },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('Found 1 results')
    expect(result.content).toContain('https://example.com')
    expect(result.content).not.toContain('blocked.com')
  })

  it('returns a compact error for missing/blank query', async () => {
    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: '   ' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error:')
    expect(result.content).toContain('Missing query')
  })

  it('returns an error when input is not an object', async () => {
    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: [] as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error:')
  })

  it('returns an error for unexpected input keys', async () => {
    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test', extra: true } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error:')
  })

  it('returns an error on non-OK HTTP responses', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('no', { status: 500 })
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error:')
    expect(result.content).toContain('HTTP 500')
  })

  it('returns an error when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error:')
    expect(result.content).toContain('network down')
  })

  it('decodes HTML entities and keeps unknown named entities intact', async () => {
    const html = [
      '<a class="result__a" href="https://example.com">A: &#65; &#x41; &unknown; &amp;</a>',
      '<div class="result__snippet">S</div>',
    ].join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('A: A A &unknown; &')
  })

  it('caps extraction at 10 results then returns maxResults=5', async () => {
    const html = Array.from({ length: 12 }, (_v, i) => {
      return `<a class="result__a" href="https://example.com/${i}">T${i}</a>`
    }).join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('Found 5 results')
  })

  it('deduplicates results by URL before formatting', async () => {
    const html = [
      '<a class="result__a" href="https://example.com/a">A</a>',
      '<a class="result__a" href="https://example.com/a">A again</a>',
      '<a class="result__a" href="https://example.com/b">B</a>',
      '<a class="result__a" href="https://example.com/c">C</a>',
    ].join('\n')

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as any

    const result = await WebSearchToolHandler.execute(
      { id: '1', name: 'WebSearch', input: { query: 'test' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('Found 3 results')
  })
})
