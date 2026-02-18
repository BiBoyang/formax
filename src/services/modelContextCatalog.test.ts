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
})

describe('getModelContextWindowsFromCatalog', () => {
  beforeEach(() => {
    __resetCatalogCacheForTests()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    __resetCatalogCacheForTests()
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
})
