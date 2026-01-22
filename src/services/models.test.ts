import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAnthropicModels, fetchCustomModels } from './models'

const { anthropicMessagesCreate } = vi.hoisted(() => ({
  anthropicMessagesCreate: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicMessagesCreate }
  },
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  anthropicMessagesCreate.mockReset()
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

describe('fetchAnthropicModels', () => {
  it('requests /v1/models and parses {data:[...]} shape', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toBe('https://example.com/v1/models')
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'claude-x',
              context_length: 123,
              supports_vision: false,
              supports_function_calling: false,
            },
          ],
        }),
        { status: 200 },
      )
    }) as any

    const models = await fetchAnthropicModels('k', 'https://example.com/v1/')
    expect(models).toEqual([
      {
        model: 'claude-x',
        provider: 'anthropic',
        max_tokens: 123,
        contextWindowTokens: 123,
        supports_reasoning_effort: false,
        supports_vision: false,
        supports_function_calling: false,
      },
    ])
    expect(anthropicMessagesCreate).toHaveBeenCalledTimes(0)
  })

  it('parses alternative response shapes (array and {models:[...]})', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'm1', max_tokens: 7 }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ model: 'm2', context_window: 9 }] }), { status: 200 }),
      ) as any

    await expect(fetchAnthropicModels('k', 'https://example.com')).resolves.toEqual([
      {
        model: 'm1',
        provider: 'anthropic',
        max_tokens: 7,
        contextWindowTokens: 7,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
    ])

    await expect(fetchAnthropicModels('k', 'https://example.com')).resolves.toEqual([
      {
        model: 'm2',
        provider: 'anthropic',
        max_tokens: 8192,
        contextWindowTokens: 9,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
    ])
    expect(anthropicMessagesCreate).toHaveBeenCalledTimes(0)
  })

  it('falls back to common models when /v1/models fetch fails, using the SDK only as a key check', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockResolvedValueOnce({} as any)

    const models = await fetchAnthropicModels('k', 'https://example.com/v1')
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true)
    expect(models.some((m) => m.model.includes('claude'))).toBe(true)
    expect(anthropicMessagesCreate).toHaveBeenCalledTimes(1)
  })

  it('maps SDK 401/authentication errors to an invalid-key message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockRejectedValueOnce(new Error('401 authentication'))

    await expect(fetchAnthropicModels('k', 'https://example.com')).rejects.toThrow(/Invalid API key/i)
  })

  it('maps SDK 403 errors to a permission message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockRejectedValueOnce(new Error('403'))

    await expect(fetchAnthropicModels('k', 'https://example.com')).rejects.toThrow(/permission/i)
  })

  it('maps network-like SDK errors to a connection message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockRejectedValueOnce(new Error('fetch failed'))

    await expect(fetchAnthropicModels('k', 'https://example.com')).rejects.toThrow(/Unable to connect/i)
  })

  it('wraps other SDK errors as API error messages', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockRejectedValueOnce(new Error('boom'))

    await expect(fetchAnthropicModels('k', 'https://example.com')).rejects.toThrow(/API error: boom/)
  })

  it('uses a generic error when the SDK throws a non-Error value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network')
    }) as any

    anthropicMessagesCreate.mockRejectedValueOnce('nope' as any)

    await expect(fetchAnthropicModels('k', 'https://example.com')).rejects.toThrow(/Failed to fetch Anthropic models/)
  })
})
