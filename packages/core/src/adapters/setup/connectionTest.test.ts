import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../core/errors/codes.js'
import { testSetupConnection } from './connectionTest.js'
import { fetchAnthropicModels, fetchCustomModels } from '../../core/models/models.js'
import { getModelContextWindowsFromCatalog, resolveCatalogProviderKeys } from '../../core/models/modelContextCatalog.js'
import { createModelContextWindowMetadata } from '../../core/models/modelCapability.js'
import type { CapabilityConfidence, CapabilitySource, ProviderId } from '../../config/settings/schema.js'

vi.mock('../../core/models/models.js', () => ({ fetchAnthropicModels: vi.fn(), fetchCustomModels: vi.fn() }))
vi.mock('../../core/models/modelContextCatalog.js', () => ({
  getModelContextWindowsFromCatalog: vi.fn(async () => ({})),
  resolveCatalogProviderKeys: vi.fn(() => []),
}))

const mockedFetchAnthropicModels = fetchAnthropicModels as unknown as ReturnType<typeof vi.fn>
const mockedFetchCustomModels = fetchCustomModels as unknown as ReturnType<typeof vi.fn>
const mockedGetModelContextWindowsFromCatalog = getModelContextWindowsFromCatalog as unknown as ReturnType<typeof vi.fn>
const mockedResolveCatalogProviderKeys = resolveCatalogProviderKeys as unknown as ReturnType<typeof vi.fn>
const originalFetch = globalThis.fetch

function metadataMap(args: {
  provider: ProviderId
  baseUrl: string
  rows: Array<{
    model: string
    tokens: number
    source: CapabilitySource
    confidence?: CapabilityConfidence
  }>
}) {
  return Object.fromEntries(
    args.rows.map((row) => [
      row.model,
      createModelContextWindowMetadata({
        provider: args.provider,
        baseUrl: args.baseUrl,
        model: row.model,
        tokens: row.tokens,
        source: row.source,
        confidence:
          row.confidence ?? (row.source === 'catalog' ? 'catalog' : row.source === 'heuristic' ? 'heuristic' : 'detected'),
      }),
    ]),
  )
}

describe('testSetupConnection', () => {
  beforeEach(() => {
    mockedFetchAnthropicModels.mockReset()
    mockedFetchCustomModels.mockReset()
    mockedGetModelContextWindowsFromCatalog.mockReset()
    mockedResolveCatalogProviderKeys.mockReset()
    mockedGetModelContextWindowsFromCatalog.mockResolvedValue({})
    mockedResolveCatalogProviderKeys.mockReturnValue([])
    globalThis.fetch = originalFetch
  })

  it('returns models for anthropic', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: 'm1', provider: 'anthropic' },
      { model: 'm2', provider: 'anthropic' },
    ] as any)
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as any

    const baseUrl = 'https://api.anthropic.com/v1'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['m1', 'm2'],
      modelContextWindows: { m1: 32768, m2: 32768 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [
          { model: 'm1', tokens: 32768, source: 'heuristic' },
          { model: 'm2', tokens: 32768, source: 'heuristic' },
        ],
      }),
    })
  })

  it('maps anthropic errors to stable codes', async () => {
    mockedFetchAnthropicModels.mockRejectedValueOnce(new Error('401 Unauthorized'))

    const res = await testSetupConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.Unauthorized)
  })

  it.each([
    ['403 Forbidden', ErrorCode.Forbidden],
    ['Request timed out', ErrorCode.Timeout],
    ['ENOTFOUND api.example.com', ErrorCode.NetworkError],
    ['SSL certificate error', ErrorCode.NetworkError],
  ])('maps anthropic error "%s"', async (message, expectedCode) => {
    mockedFetchAnthropicModels.mockRejectedValueOnce(new Error(message))

    const res = await testSetupConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(expectedCode)
  })

  it('returns models for openai-compatible providers', async () => {
    mockedFetchCustomModels.mockResolvedValueOnce([{ id: 'gpt-4o' }, { model: 'gpt-4.1-mini' }] as any)
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as any

    const baseUrl = 'https://api.openai.com/v1'
    const res = await testSetupConnection({ provider: 'openai', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['gpt-4o', 'gpt-4.1-mini'],
      modelContextWindows: { 'gpt-4o': 128000, 'gpt-4.1-mini': 128000 },
      modelContextWindowMetadata: metadataMap({
        provider: 'openai',
        baseUrl,
        rows: [
          { model: 'gpt-4o', tokens: 128000, source: 'heuristic' },
          { model: 'gpt-4.1-mini', tokens: 128000, source: 'heuristic' },
        ],
      }),
    })
  })

  it('uses explicit context metadata when custom providers return it', async () => {
    mockedFetchCustomModels.mockResolvedValueOnce([{ id: 'x-1', context_window: 64000 }] as any)

    const baseUrl = 'https://example.com/v1'
    const res = await testSetupConnection({ provider: 'openai', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['x-1'],
      modelContextWindows: { 'x-1': 64000 },
      modelContextWindowMetadata: metadataMap({
        provider: 'openai',
        baseUrl,
        rows: [{ model: 'x-1', tokens: 64000, source: 'provider_list' }],
      }),
    })
  })

  it('fills missing context from models.dev catalog when available', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([{ model: 'glm-5', provider: 'anthropic' }] as any)
    mockedResolveCatalogProviderKeys.mockReturnValueOnce(['zhipuai'])
    mockedGetModelContextWindowsFromCatalog.mockResolvedValueOnce({ 'glm-5': 204800 })

    const baseUrl = 'https://open.bigmodel.cn/api/anthropic'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['glm-5'],
      modelContextWindows: { 'glm-5': 204800 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [{ model: 'glm-5', tokens: 204800, source: 'catalog' }],
      }),
    })
  })

  it('probes model detail endpoints for missing anthropic-compatible context windows before catalog fallback', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([{ model: 'deepseek-v4-flash', provider: 'anthropic' }] as any)
    mockedResolveCatalogProviderKeys.mockReturnValueOnce(['deepseek'])
    mockedGetModelContextWindowsFromCatalog.mockResolvedValueOnce({})
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url) === 'https://api.deepseek.com/v1/models/deepseek-v4-flash') {
        return new Response(
          JSON.stringify({
            id: 'deepseek-v4-flash',
            limit: { context: 1_000_000 },
          }),
          { status: 200 },
        )
      }
      return new Response('nope', { status: 404 })
    }) as any

    const baseUrl = 'https://api.deepseek.com/anthropic'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })

    expect(res).toEqual({
      ok: true,
      models: ['deepseek-v4-flash'],
      modelContextWindows: { 'deepseek-v4-flash': 1_000_000 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [{ model: 'deepseek-v4-flash', tokens: 1_000_000, source: 'provider_detail' }],
      }),
    })
    expect(mockedGetModelContextWindowsFromCatalog).not.toHaveBeenCalled()
  })

  it('does not let anthropic max_tokens block deeper context-window probing', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: 'deepseek-v4-flash', provider: 'anthropic', max_tokens: 8192 },
    ] as any)
    mockedResolveCatalogProviderKeys.mockReturnValueOnce(['deepseek'])
    mockedGetModelContextWindowsFromCatalog.mockResolvedValueOnce({})
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url) === 'https://api.deepseek.com/v1/models/deepseek-v4-flash') {
        return new Response(
          JSON.stringify({
            id: 'deepseek-v4-flash',
            limit: { context: 1_000_000 },
          }),
          { status: 200 },
        )
      }
      return new Response('nope', { status: 404 })
    }) as any

    const baseUrl = 'https://api.deepseek.com/anthropic'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })

    expect(res).toEqual({
      ok: true,
      models: ['deepseek-v4-flash'],
      modelContextWindows: { 'deepseek-v4-flash': 1_000_000 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [{ model: 'deepseek-v4-flash', tokens: 1_000_000, source: 'provider_detail' }],
      }),
    })
    expect(mockedGetModelContextWindowsFromCatalog).not.toHaveBeenCalled()
  })

  it('uses token_limits.context_window from /v1/models rows before catalog/default fallback', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      {
        model: 'glm-4-7-251222',
        token_limits: {
          context_window: 204800,
          max_input_token_length: 204800,
        },
      },
    ] as any)

    const baseUrl = 'https://open.bigmodel.cn/api/anthropic'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['glm-4-7-251222'],
      modelContextWindows: { 'glm-4-7-251222': 204800 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [{ model: 'glm-4-7-251222', tokens: 204800, source: 'provider_list' }],
      }),
    })
    expect(mockedGetModelContextWindowsFromCatalog).not.toHaveBeenCalled()
  })

  it('normalizes anthropic rows and infers context windows across model families', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: ' claude-3-5-sonnet ' },
      { model: 'gpt-4o-mini' },
      { model: 'gpt-4.1-mini' },
      { model: 'gpt-4-turbo' },
      { model: 'gpt-4' },
      { model: 'gpt-4-32k' },
      { model: 'gpt-3.5-turbo' },
      { model: 'o3-mini' },
      { model: 'unknown-model' },
      { model: 'string-context', context_window: '64000' },
      { model: 'rounded-context', context_length: 12345.6 },
      { model: '' },
    ] as any)
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as any

    const baseUrl = 'https://api.anthropic.com/v1'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: [
        'claude-3-5-sonnet',
        'gpt-4o-mini',
        'gpt-4.1-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-4-32k',
        'gpt-3.5-turbo',
        'o3-mini',
        'unknown-model',
        'string-context',
        'rounded-context',
      ],
      modelContextWindows: {
        'claude-3-5-sonnet': 200000,
        'gpt-4o-mini': 128000,
        'gpt-4.1-mini': 128000,
        'gpt-4-turbo': 128000,
        'gpt-4': 8192,
        'gpt-4-32k': 8192,
        'gpt-3.5-turbo': 16385,
        'o3-mini': 128000,
        'unknown-model': 32768,
        'string-context': 64000,
        'rounded-context': 12346,
      },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [
          { model: 'claude-3-5-sonnet', tokens: 200000, source: 'heuristic' },
          { model: 'gpt-4o-mini', tokens: 128000, source: 'heuristic' },
          { model: 'gpt-4.1-mini', tokens: 128000, source: 'heuristic' },
          { model: 'gpt-4-turbo', tokens: 128000, source: 'heuristic' },
          { model: 'gpt-4', tokens: 8192, source: 'heuristic' },
          { model: 'gpt-4-32k', tokens: 8192, source: 'heuristic' },
          { model: 'gpt-3.5-turbo', tokens: 16385, source: 'heuristic' },
          { model: 'o3-mini', tokens: 128000, source: 'heuristic' },
          { model: 'unknown-model', tokens: 32768, source: 'heuristic' },
          { model: 'string-context', tokens: 64000, source: 'provider_list' },
          { model: 'rounded-context', tokens: 12346, source: 'provider_list' },
        ],
      }),
    })
  })

  it('skips catalog lookup for anthropic when all models provide explicit context', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: 'a', contextWindowTokens: 1000 },
      { model: 'b', context_window: '2000' },
      { model: 'c', context_length: 3000.4 },
    ] as any)

    const baseUrl = 'https://api.anthropic.com/v1'
    const res = await testSetupConnection({ provider: 'anthropic', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['a', 'b', 'c'],
      modelContextWindows: { a: 1000, b: 2000, c: 3000 },
      modelContextWindowMetadata: metadataMap({
        provider: 'anthropic',
        baseUrl,
        rows: [
          { model: 'a', tokens: 1000, source: 'provider_list' },
          { model: 'b', tokens: 2000, source: 'provider_list' },
          { model: 'c', tokens: 3000, source: 'provider_list' },
        ],
      }),
    })
    expect(mockedGetModelContextWindowsFromCatalog).not.toHaveBeenCalled()
  })

  it('normalizes openai model identifiers and ignores empty/invalid entries', async () => {
    mockedFetchCustomModels.mockResolvedValueOnce([
      { model: 'model-field-name', input_token_limit: '8192' },
      { name: 'name-field-only', inputTokenLimit: 4096.2 },
      { id: '  id-field  ', context_length: 200000 },
      { id: '', model: '', name: '' },
      {},
    ] as any)

    const baseUrl = 'https://api.openai.com/v1'
    const res = await testSetupConnection({ provider: 'openai', baseUrl, apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['model-field-name', 'name-field-only', 'id-field'],
      modelContextWindows: {
        'model-field-name': 8192,
        'name-field-only': 4096,
        'id-field': 200000,
      },
      modelContextWindowMetadata: metadataMap({
        provider: 'openai',
        baseUrl,
        rows: [
          { model: 'model-field-name', tokens: 8192, source: 'provider_list' },
          { model: 'name-field-only', tokens: 4096, source: 'provider_list' },
          { model: 'id-field', tokens: 200000, source: 'provider_list' },
        ],
      }),
    })
  })

  it('maps openai-compatible errors to stable codes', async () => {
    mockedFetchCustomModels.mockRejectedValueOnce(new Error('401 Unauthorized'))
    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.Unauthorized)
  })

  it('returns an explicit error when openai-compatible provider returns no models', async () => {
    mockedFetchCustomModels.mockResolvedValueOnce([] as any)
    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' })
    expect(res).toEqual({
      ok: false,
      code: ErrorCode.Unknown,
      message: 'No models returned from provider.',
    })
  })

  it('returns a clear placeholder for gemini', async () => {
    const res = await testSetupConnection({ provider: 'gemini', baseUrl: 'https://api.gemini.google.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.SetupRequired)
    expect(res.message).toContain('Gemini setup is not implemented yet')
  })

  it('returns Unknown for unknown providers', async () => {
    const res = await testSetupConnection({ provider: 'wat' as any, baseUrl: 'https://example.com', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.Unknown)
    expect(res.message).toContain('Unknown provider:')
  })
})
