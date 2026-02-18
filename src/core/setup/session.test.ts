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
const okWithContext = (models: string[], modelContextWindows: Record<string, number>): ConnectionTestResult => ({
  ok: true,
  models,
  modelContextWindows,
})
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
    expect(s.getState().step).toBe('anthropicVendor')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')

    await s.next()
    expect(s.getState().step).toBe('apiKey')

    s.setApiKey('sk-test')
    await s.next()

    const stateAfterTest = s.getState()
    expect(stateAfterTest.step).toBe('modelMode')
    expect(stateAfterTest.availableModels).toEqual(['model-a', 'model-b'])
    expect(testConnection).toHaveBeenCalledTimes(1)

    await s.next()
    expect(s.getState().step).toBe('model')

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
    await s.next()
    s.setApiKey('sk-test')
    await s.next()

    expect(s.getState().step).toBe('modelMode')
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
    expect(stateAfterRetry.step).toBe('modelMode')
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
    expect(s.getState().step).toBe('anthropicVendor')
    s.back()
    expect(s.getState().step).toBe('provider')

    await s.next()
    expect(s.getState().step).toBe('anthropicVendor')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')
    s.back()
    expect(s.getState().step).toBe('anthropicVendor')

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
    expect(s.getState().step).toBe('modelMode')
    await s.next()
    expect(s.getState().step).toBe('model')
    s.back()
    expect(s.getState().step).toBe('modelMode')
  })

  it('supports advanced mode with per-tier model selection', async () => {
    const testConnection = vi.fn(async () => ok(['m-a', 'm-b', 'm-c']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()
    expect(s.getState().step).toBe('modelMode')

    s.setModelMode('advanced')
    await s.next()
    expect(s.getState().step).toBe('model')
    expect(s.getState().modelTier).toBe('haiku')

    s.setModel('m-a')
    await s.next()
    expect(s.getState().modelTier).toBe('sonnet')

    s.setModel('m-b')
    await s.next()
    expect(s.getState().modelTier).toBe('opus')

    s.setModel('m-c')
    await s.next()

    const state = s.getState()
    expect(state.step).toBe('confirm')
    expect(state.draft.tierModels).toEqual({ haiku: 'm-a', sonnet: 'm-b', opus: 'm-c' })
    expect(state.draft.model).toBe('m-b')
  })

  it('quick mode maps one model to all tiers', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()
    expect(s.getState().step).toBe('modelMode')

    s.setModelMode('quick')
    await s.next()
    s.setModel('m1')
    await s.next()

    const draft = s.getState().draft
    expect(draft.tierModels).toEqual({ haiku: 'm1', sonnet: 'm1', opus: 'm1' })
    expect(draft.model).toBe('m1')
    expect(draft.contextWindowTokens).toBe(32768)
  })

  it('maps anthropic vendor presets to baseUrl and supports custom empty URL', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    expect(s.getState().draft.anthropicVendor).toBe('anthropic')
    expect(s.getState().draft.baseUrl).toBe('https://api.anthropic.com/v1')

    s.setAnthropicVendor('glm')
    expect(s.getState().draft.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic')

    s.setAnthropicVendor('kimi')
    expect(s.getState().draft.baseUrl).toBe('https://api.moonshot.cn/anthropic')

    s.setAnthropicVendor('minimax')
    expect(s.getState().draft.baseUrl).toBe('https://api.minimax.io/anthropic')

    s.setAnthropicVendor('custom')
    expect(s.getState().draft.baseUrl).toBe('')
  })

  it('preserves custom anthropic baseUrl when reselecting custom vendor', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    s.setAnthropicVendor('custom')
    s.setBaseUrl('https://proxy.example.com/anthropic')
    s.setAnthropicVendor('custom')
    expect(s.getState().draft.baseUrl).toBe('https://proxy.example.com/anthropic')
  })

  it('goes directly to baseUrl for openai provider', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    s.back()
    s.back()
    s.setProvider('openai')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')
    expect(s.getState().draft.anthropicVendor).toBeNull()
    expect(s.getState().draft.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('preserves custom baseUrl when reselecting the same provider', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('openai')
    s.setBaseUrl('https://proxy.local/v1')
    s.setProvider('openai')
    expect(s.getState().draft.baseUrl).toBe('https://proxy.local/v1')
  })

  it('tracks context window tokens from detected model metadata', async () => {
    const testConnection = vi.fn(async () => okWithContext(['m1', 'm2'], { m1: 8000, m2: 64000 }))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()
    await s.next()

    s.setModel('m2')
    expect(s.getState().draft.contextWindowTokens).toBe(64000)

    s.setModel('m1')
    expect(s.getState().draft.contextWindowTokens).toBe(8000)
  })
})
