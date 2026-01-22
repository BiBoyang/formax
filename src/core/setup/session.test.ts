import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import type { ErrorCode as ErrorCodeValue } from '../errors/codes.js'
import { createSetupSession } from './session.js'
import type { ConnectionTestResult, SetupProviderOption } from './types.js'

const PROVIDERS: SetupProviderOption[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'gemini', label: 'Gemini', disabled: true },
]

const ok = (models: string[]): ConnectionTestResult => ({ ok: true, models })
const err = (code: ErrorCodeValue, message: string): ConnectionTestResult => ({ ok: false, code, message })

describe('createSetupSession', () => {
  it('does not force a /v1 suffix in baseUrl input', async () => {
    const testConnection = vi.fn(async () => ok(['model-a']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')

    s.setBaseUrl('https://api.anthropic.com')
    expect(s.getState().draft.baseUrl).toBe('https://api.anthropic.com')

    s.setBaseUrl('https://api.anthropic.com/v1')
    expect(s.getState().draft.baseUrl).toBe('https://api.anthropic.com/v1')

    s.setBaseUrl('https://api.anthropic.com/v1/')
    expect(s.getState().draft.baseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('walks through the happy path', async () => {
    const testConnection = vi.fn(async () => ok(['model-a', 'model-b']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    expect(s.getState().step).toBe('welcome')

    await s.next()
    expect(s.getState().step).toBe('provider')

    s.setProvider('anthropic')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')

    await s.next()
    expect(s.getState().step).toBe('apiKey')

    s.setApiKey('sk-test')
    await s.next()

    const stateAfterTest = s.getState()
    expect(stateAfterTest.step).toBe('model')
    expect(stateAfterTest.availableModels).toEqual(['model-a', 'model-b'])
    expect(testConnection).toHaveBeenCalledTimes(1)

    s.setModel('model-a')
    await s.next()
    expect(s.getState().step).toBe('confirm')

    await s.next()
    expect(s.getState().step).toBe('write')

    await s.next()
    expect(s.getState().step).toBe('done')
  })

  it('requires provider selection', async () => {
    const testConnection = vi.fn(async () => ok([]))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    expect(s.getState().step).toBe('provider')

    await s.next()
    const state = s.getState()
    expect(state.step).toBe('provider')
    expect(state.error).toBe('Select a provider')
  })

  it('requires model selection', async () => {
    const testConnection = vi.fn(async () => ok(['model-a']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()

    expect(s.getState().step).toBe('model')
    await s.next()
    expect(s.getState().step).toBe('model')
    expect(s.getState().error).toBe('Select a model')
  })

  it('surfaces connection test errors and allows retry', async () => {
    const testConnection = vi
      .fn()
      .mockResolvedValueOnce(err(ErrorCode.Unauthorized, 'bad key'))
      .mockResolvedValueOnce(ok(['model-a']))

    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()

    const stateAfterFail = s.getState()
    expect(stateAfterFail.step).toBe('test')
    expect(stateAfterFail.test.status).toBe('error')
    expect(stateAfterFail.error).toBe('bad key')

    s.setApiKey('sk-fixed')
    await s.next()

    const stateAfterRetry = s.getState()
    expect(stateAfterRetry.step).toBe('model')
    expect(stateAfterRetry.availableModels).toEqual(['model-a'])
    expect(testConnection).toHaveBeenCalledTimes(2)
  })

  it('converts thrown test errors into an error state', async () => {
    const testConnection = vi.fn(async () => {
      throw new Error('boom')
    })

    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()

    const state = s.getState()
    expect(state.step).toBe('test')
    expect(state.test.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('supports back navigation', async () => {
    const testConnection = vi.fn(async () => ok(['model-a']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    expect(s.getState().step).toBe('welcome')
    s.back()
    expect(s.getState().step).toBe('welcome')

    await s.next()
    expect(s.getState().step).toBe('provider')
    s.back()
    expect(s.getState().step).toBe('welcome')

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')
    s.back()
    expect(s.getState().step).toBe('provider')

    await s.next()
    expect(s.getState().step).toBe('baseUrl')
    await s.next()
    expect(s.getState().step).toBe('apiKey')
    s.back()
    expect(s.getState().step).toBe('baseUrl')

    await s.next()
    expect(s.getState().step).toBe('apiKey')
    s.setApiKey('sk-test')
    await s.next()
    expect(s.getState().step).toBe('model')
    s.back()
    expect(s.getState().step).toBe('apiKey')
  })
})
