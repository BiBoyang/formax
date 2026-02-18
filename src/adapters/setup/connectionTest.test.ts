import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../core/errors/codes.js'
import { testSetupConnection } from './connectionTest.js'
import { fetchAnthropicModels, fetchCustomModels } from '../../services/models.js'
import { getModelContextWindowsFromCatalog, resolveCatalogProviderKeys } from '../../services/modelContextCatalog.js'

vi.mock('../../services/models.js', () => ({ fetchAnthropicModels: vi.fn(), fetchCustomModels: vi.fn() }))
vi.mock('../../services/modelContextCatalog.js', () => ({
  getModelContextWindowsFromCatalog: vi.fn(async () => ({})),
  resolveCatalogProviderKeys: vi.fn(() => []),
}))

const mockedFetchAnthropicModels = fetchAnthropicModels as unknown as ReturnType<typeof vi.fn>
const mockedFetchCustomModels = fetchCustomModels as unknown as ReturnType<typeof vi.fn>
const mockedGetModelContextWindowsFromCatalog = getModelContextWindowsFromCatalog as unknown as ReturnType<typeof vi.fn>
const mockedResolveCatalogProviderKeys = resolveCatalogProviderKeys as unknown as ReturnType<typeof vi.fn>

describe('testSetupConnection', () => {
  beforeEach(() => {
    mockedFetchAnthropicModels.mockReset()
    mockedFetchCustomModels.mockReset()
    mockedGetModelContextWindowsFromCatalog.mockReset()
    mockedResolveCatalogProviderKeys.mockReset()
    mockedGetModelContextWindowsFromCatalog.mockResolvedValue({})
    mockedResolveCatalogProviderKeys.mockReturnValue([])
  })

  it('returns models for anthropic', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: 'm1', provider: 'anthropic' },
      { model: 'm2', provider: 'anthropic' },
    ] as any)

    const res = await testSetupConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['m1', 'm2'],
      modelContextWindows: { m1: 32768, m2: 32768 },
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

    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['gpt-4o', 'gpt-4.1-mini'],
      modelContextWindows: { 'gpt-4o': 128000, 'gpt-4.1-mini': 128000 },
    })
  })

  it('uses explicit context metadata when custom providers return it', async () => {
    mockedFetchCustomModels.mockResolvedValueOnce([{ id: 'x-1', context_window: 64000 }] as any)

    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'sk' })
    expect(res).toEqual({
      ok: true,
      models: ['x-1'],
      modelContextWindows: { 'x-1': 64000 },
    })
  })

  it('fills missing context from models.dev catalog when available', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([{ model: 'glm-5', provider: 'anthropic' }] as any)
    mockedResolveCatalogProviderKeys.mockReturnValueOnce(['zhipuai'])
    mockedGetModelContextWindowsFromCatalog.mockResolvedValueOnce({ 'glm-5': 204800 })

    const res = await testSetupConnection({
      provider: 'anthropic',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'sk',
    })
    expect(res).toEqual({
      ok: true,
      models: ['glm-5'],
      modelContextWindows: { 'glm-5': 204800 },
    })
  })

  it('maps openai-compatible errors to stable codes', async () => {
    mockedFetchCustomModels.mockRejectedValueOnce(new Error('401 Unauthorized'))
    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.Unauthorized)
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
