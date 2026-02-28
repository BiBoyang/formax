import { describe, expect, it, vi, afterEach } from 'vitest'
import { createWebFetchToolHandler } from './handler'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('createWebFetchToolHandler', () => {
  it('matches tool name with canHandle', () => {
    const handler = createWebFetchToolHandler({ client: { streamOnce: vi.fn() } as any })
    expect(handler.canHandle('WebFetch')).toBe(true)
    expect(handler.canHandle('Other')).toBe(false)
  })

  it('fetches URL, upgrades http->https, and calls analyzer client', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toBe('https://example.com/')
      return new Response('<html><body><h1>Hello</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      expect(args.maxTokens).toBe(55)
      const text = args.messages?.[0]?.content?.[0]?.text || ''
      expect(String(text)).toContain('URL: https://example.com/')
      expect(String(text)).toContain('User prompt: What is this page?')
      const toolRes = await args.executeTool?.({ id: 'tool-1' })
      expect(toolRes).toEqual({
        tool_use_id: 'tool-1',
        content: 'Tool use is disabled for WebFetch analysis',
        is_error: true,
      })
      args.onEvent?.({ type: 'assistant_delta', text: 'Summary' })
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })

    const handler = createWebFetchToolHandler({
      client: { streamOnce } as any,
      maxTokens: 55,
      maxInputChars: 1000,
    })

    const result = await handler.execute(
      {
        id: '1',
        name: 'WebFetch',
        input: { url: 'http://example.com', prompt: 'What is this page?' },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('Summary')
  })

  it('returns (no output) when stream produces no assistant text', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('plain text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      args.onEvent?.({ type: 'tool_result', text: 'ignored' })
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })
    const handler = createWebFetchToolHandler({
      client: { streamOnce } as any,
      maxInputChars: 1000,
    })

    const result = await handler.execute(
      {
        id: '2',
        name: 'WebFetch',
        input: { url: 'https://example.com', prompt: 'Summarize' },
      },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('(no output)')
  })

  it('handles html-like content even without html content-type and decodes entities', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        '<!doctype html><body><script>ignore()</script><p>A &amp; B &#65; &#x41; &#x110000;</p></body>',
        { status: 200, headers: { 'content-type': 'text/plain' } },
      )
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      const text = args.messages?.[0]?.content?.[0]?.text || ''
      expect(String(text)).toContain('A & B A A &#x110000;')
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })

    const handler = createWebFetchToolHandler({
      client: { streamOnce } as any,
      maxInputChars: 10_000,
    })

    const result = await handler.execute(
      { id: '3', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'Extract text' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
  })

  it('truncates fetched body to maxInputChars before sending to model', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('x'.repeat(1000), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      const text = String(args.messages?.[0]?.content?.[0]?.text || '')
      const pageContent = text.split('\nPage content:\n')[1] || ''
      expect(pageContent.length).toBe(20)
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })

    const handler = createWebFetchToolHandler({
      client: { streamOnce } as any,
      maxInputChars: 20,
    })

    const result = await handler.execute(
      { id: '4', name: 'WebFetch', input: { url: 'https://example.com', prompt: 't' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
  })

  it('returns validation errors for bad input', async () => {
    const handler = createWebFetchToolHandler({ client: { streamOnce: vi.fn() } as any })

    const missingInput = await handler.execute(
      { id: '5a', name: 'WebFetch' } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(missingInput.is_error).toBe(true)
    expect(missingInput.content).toContain('Missing url')

    const badObj = await handler.execute(
      { id: '5', name: 'WebFetch', input: [] as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(badObj.is_error).toBe(true)

    const missingUrl = await handler.execute(
      { id: '6', name: 'WebFetch', input: { prompt: 'x' } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(missingUrl.content).toContain('Missing url')

    const missingPrompt = await handler.execute(
      { id: '7', name: 'WebFetch', input: { url: 'https://example.com' } as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(missingPrompt.content).toContain('Missing prompt')

    const invalidUrl = await handler.execute(
      { id: '8', name: 'WebFetch', input: { url: 'not-a-url', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(invalidUrl.content).toContain('Invalid url')

    const invalidProtocol = await handler.execute(
      { id: '9', name: 'WebFetch', input: { url: 'ftp://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(invalidProtocol.content).toContain('Only http/https URLs are supported')
  })

  it('returns fetch/HTTP errors', async () => {
    const handler = createWebFetchToolHandler({ client: { streamOnce: vi.fn() } as any })

    globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as any
    const httpErr = await handler.execute(
      { id: '10', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(httpErr.is_error).toBe(true)
    expect(httpErr.content).toContain('HTTP 500')

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any
    const netErr = await handler.execute(
      { id: '11', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(netErr.is_error).toBe(true)
    expect(netErr.content).toContain('network down')
  })

  it('propagates client stream exceptions as tool errors', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } })
    }) as any

    const handler = createWebFetchToolHandler({
      client: {
        streamOnce: vi.fn(async () => {
          throw new Error('stream failed')
        }),
      } as any,
    })

    const result = await handler.execute(
      { id: '12', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('stream failed')
  })

  it('stringifies non-Error throws in execute catch', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } })
    }) as any

    const handler = createWebFetchToolHandler({
      client: {
        streamOnce: vi.fn(async () => {
          throw 'boom'
        }),
      } as any,
    })

    const result = await handler.execute(
      { id: '13', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: boom')
  })

  it('handles missing content-type header and keeps unknown named entities', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('<html><body>&unknown;</body></html>', {
        status: 200,
      })
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      const text = String(args.messages?.[0]?.content?.[0]?.text || '')
      expect(text).toContain('&unknown;')
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })
    const handler = createWebFetchToolHandler({ client: { streamOnce } as any })

    const result = await handler.execute(
      { id: '14', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
  })

  it('keeps invalid huge numeric entities unchanged', async () => {
    const huge = `&#${'9'.repeat(400)};`
    globalThis.fetch = vi.fn(async () => {
      return new Response(`<html><body>${huge}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      const text = String(args.messages?.[0]?.content?.[0]?.text || '')
      expect(text).toContain(huge)
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })
    const handler = createWebFetchToolHandler({ client: { streamOnce } as any })

    const result = await handler.execute(
      { id: '15', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
  })

  it('uses empty-string fallback when response content-type header is null', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => 'plain body',
      } as any
    }) as any

    const streamOnce = vi.fn(async (args: any) => {
      const text = String(args.messages?.[0]?.content?.[0]?.text || '')
      expect(text).toContain('Page content:\nplain body')
      return { contentBlocks: [], stopReason: 'end_turn', toolResults: [] }
    })

    const handler = createWebFetchToolHandler({ client: { streamOnce } as any })
    const result = await handler.execute(
      { id: '16', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'x' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )
    expect(result.is_error).toBeUndefined()
  })
})
