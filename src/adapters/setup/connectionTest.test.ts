import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../core/errors/codes.js'
import { testSetupConnection } from './connectionTest.js'
import { fetchAnthropicModels } from '../../services/models.js'

vi.mock('../../services/models.js', () => ({ fetchAnthropicModels: vi.fn() }))

const mockedFetchAnthropicModels = vi.mocked(fetchAnthropicModels)

describe('testSetupConnection', () => {
  it('returns models for anthropic', async () => {
    mockedFetchAnthropicModels.mockResolvedValueOnce([
      { model: 'm1', provider: 'anthropic' },
      { model: 'm2', provider: 'anthropic' },
    ] as any)

    const res = await testSetupConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk' })
    expect(res).toEqual({ ok: true, models: ['m1', 'm2'] })
  })

  it('maps anthropic errors to stable codes', async () => {
    mockedFetchAnthropicModels.mockRejectedValueOnce(new Error('401 Unauthorized'))

    const res = await testSetupConnection({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.Unauthorized)
  })

  it('returns a clear placeholder for unimplemented providers', async () => {
    const res = await testSetupConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk' })
    if (!('code' in res)) throw new Error('Expected error result')
    expect(res.code).toBe(ErrorCode.SetupRequired)
    expect(res.message).toContain('not implemented')
  })
})
