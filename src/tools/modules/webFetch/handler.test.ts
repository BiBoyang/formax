import { describe, expect, it, vi, afterEach } from 'vitest'
import { createWebFetchToolHandler } from './handler'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('createWebFetchToolHandler', () => {
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
})

