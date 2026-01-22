import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCustomModels } from './models'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('fetchCustomModels', () => {
  it('normalizes baseURL and selects the correct /models endpoint', async () => {
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      expect(init?.headers?.Authorization).toBe('Bearer k')
      expect(init?.headers?.['Content-Type']).toBe('application/json')

      if (String(url) === 'https://example.com/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
      }
      if (String(url) === 'https://example.com/v2/models') {
        return new Response(JSON.stringify({ data: [{ id: 'm2' }] }), { status: 200 })
      }
      throw new Error(`Unexpected URL: ${String(url)}`)
    }) as any

    await expect(fetchCustomModels('https://example.com', 'k')).resolves.toEqual([{ id: 'm1' }])
    await expect(fetchCustomModels('https://example.com/v2/', 'k')).resolves.toEqual([{ id: 'm2' }])
  })

  it('extracts models from multiple supported response shapes', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'b' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ id: 'c' }] }), { status: 200 })) as any

    await expect(fetchCustomModels('https://example.com', 'k')).resolves.toEqual([{ id: 'a' }])
    await expect(fetchCustomModels('https://example.com', 'k')).resolves.toEqual([{ id: 'b' }])
    await expect(fetchCustomModels('https://example.com', 'k')).resolves.toEqual([{ id: 'c' }])
  })

  it('maps non-OK status codes to user-friendly errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const cases: Array<[number, RegExp]> = [
      [401, /Invalid API key/i],
      [403, /does not have permission/i],
      [404, /endpoint not found/i],
      [429, /Too many requests/i],
      [503, /temporarily unavailable/i],
      [418, /Unable to connect to API/i],
    ]

    for (const [status, pattern] of cases) {
      globalThis.fetch = vi.fn(async () => new Response('nope', { status })) as any
      await expect(fetchCustomModels('https://example.com', 'k')).rejects.toThrow(pattern)
    }
  })

  it('throws a clear error for unsupported response formats', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ nope: [] }), { status: 200 })) as any
    await expect(fetchCustomModels('https://example.com', 'k')).rejects.toThrow(/response format/i)
  })

  it('maps network-like failures to a connection error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch failed')
    }) as any
    await expect(fetchCustomModels('https://example.com', 'k')).rejects.toThrow(/Unable to connect/i)
  })
})
