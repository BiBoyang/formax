import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCatalogCacheForTests,
  getModelContextWindowsFromCatalog,
  resolveCatalogProviderKeys,
} from './modelContextCatalog.js'

describe('resolveCatalogProviderKeys', () => {
  it('maps anthropic-compatible CN vendors by host', () => {
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic' })).toEqual([
      'zhipuai',
    ])
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://api.moonshot.cn/anthropic' })).toEqual([
      'moonshotai-cn',
      'moonshotai',
    ])
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://api.minimax.io/anthropic' })).toEqual([
      'minimax',
      'minimax-cn',
    ])
  })

  it('falls back to broad anthropic-compatible keys when host is unknown', () => {
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://proxy.example.com/v1' })).toEqual([
      'anthropic',
      'zhipuai',
      'moonshotai-cn',
      'moonshotai',
      'minimax-cn',
      'minimax',
    ])
  })

  it('always includes openai key for openai provider', () => {
    expect(resolveCatalogProviderKeys({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1' })).toEqual(['openai'])
  })

  it('maps known hosts and deduplicates provider keys', () => {
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://api.moonshot.ai/v1' })).toEqual([
      'moonshotai',
      'moonshotai-cn',
    ])
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://api.minimaxi.com/v1' })).toEqual([
      'minimax-cn',
      'minimax',
    ])
    expect(resolveCatalogProviderKeys({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' })).toEqual([
      'anthropic',
    ])
    expect(resolveCatalogProviderKeys({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' })).toEqual([
      'openai',
    ])
  })

  it('returns empty keys for invalid base url with non-openai provider', () => {
    expect(resolveCatalogProviderKeys({ provider: 'custom' as any, baseUrl: 'not-a-url' })).toEqual([])
  })

  it('handles empty/undefined base url input', () => {
    expect(resolveCatalogProviderKeys({ provider: 'custom' as any, baseUrl: '' })).toEqual([])
    expect(resolveCatalogProviderKeys({ provider: 'custom' as any, baseUrl: undefined as any })).toEqual([])
  })
})

describe('getModelContextWindowsFromCatalog', () => {
  beforeEach(() => {
    __resetCatalogCacheForTests()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    __resetCatalogCacheForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads context windows from models.dev provider models table', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        zhipuai: {
          models: {
            'glm-5': { limit: { context: 204800 } },
            'glm-4': { limit: { context: '128000' } },
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await getModelContextWindowsFromCatalog({
      providerKeys: ['zhipuai'],
      modelIds: ['glm-5', 'glm-4', 'missing'],
    })

    expect(out).toEqual({ 'glm-5': 204800, 'glm-4': 128000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches catalog responses in-memory', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        anthropic: {
          models: {
            'claude-3-5-sonnet-latest': { limit: { context: 200000 } },
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getModelContextWindowsFromCatalog({
      providerKeys: ['anthropic'],
      modelIds: ['claude-3-5-sonnet-latest'],
    })
    await getModelContextWindowsFromCatalog({
      providerKeys: ['anthropic'],
      modelIds: ['claude-3-5-sonnet-latest'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns empty object when providerKeys/modelIds are empty', async () => {
    expect(await getModelContextWindowsFromCatalog({ providerKeys: [], modelIds: ['m1'] })).toEqual({})
    expect(await getModelContextWindowsFromCatalog({ providerKeys: ['p1'], modelIds: [] })).toEqual({})
    expect(await getModelContextWindowsFromCatalog({ providerKeys: undefined as any, modelIds: undefined as any })).toEqual(
      {},
    )
  })

  it('returns empty object for fetch failures and invalid responses', async () => {
    const notOkFetch = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', notOkFetch)
    expect(await getModelContextWindowsFromCatalog({ providerKeys: ['anthropic'], modelIds: ['m1'] })).toEqual({})
    expect(notOkFetch).toHaveBeenCalledTimes(1)

    __resetCatalogCacheForTests()
    const nonObjectFetch = vi.fn(async () => ({ ok: true, json: async () => 123 }))
    vi.stubGlobal('fetch', nonObjectFetch)
    expect(await getModelContextWindowsFromCatalog({ providerKeys: ['anthropic'], modelIds: ['m1'] })).toEqual({})

    __resetCatalogCacheForTests()
    const throwsFetch = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', throwsFetch)
    expect(await getModelContextWindowsFromCatalog({ providerKeys: ['anthropic'], modelIds: ['m1'] })).toEqual({})
  })

  it('ignores invalid context values and trims keys/model ids', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        anthropic: {
          models: {
            a: { limit: { context: 'not-number' } },
            b: { limit: { context: -1 } },
            c: { limit: { context: 100.4 } },
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await getModelContextWindowsFromCatalog({
      providerKeys: [' anthropic '],
      modelIds: ['a', 'b', ' c ', 'c', ''],
    })

    expect(out).toEqual({ c: 100 })
  })

  it('drops falsy provider keys during normalization', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        anthropic: { models: { m1: { limit: { context: 10 } } } },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await getModelContextWindowsFromCatalog({
      providerKeys: ['' as any, ' anthropic '],
      modelIds: ['m1'],
    })

    expect(out).toEqual({ m1: 10 })
  })

  it('aborts catalog fetch after timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      (url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    vi.stubGlobal('fetch', fetchMock as any)

    const promise = getModelContextWindowsFromCatalog({
      providerKeys: ['anthropic'],
      modelIds: ['m1'],
    })

    await vi.advanceTimersByTimeAsync(3000)
    await expect(promise).resolves.toEqual({})
  })
})
