import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import type { ErrorCode as ErrorCodeValue } from '../errors/codes.js'
import { createSetupSession, __setupSessionTestOnly } from './session.js'
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
  it('covers setup helper branches', () => {
    expect(__setupSessionTestOnly.createEmptyTierModels()).toEqual({ haiku: '', sonnet: '', opus: '' })
    expect(__setupSessionTestOnly.pickTierModel('haiku-model', 'fallback-model')).toBe('haiku-model')
    expect(__setupSessionTestOnly.pickTierModel('', 'fallback-model')).toBe('fallback-model')
    expect(__setupSessionTestOnly.normalizeBaseUrl('anthropic', '')).toBe('')
    expect(__setupSessionTestOnly.normalizeBaseUrl('openai', ' https://x/v1/// ')).toBe('https://x/v1')

    expect(__setupSessionTestOnly.inferContextWindowTokens('')).toBe(32768)
    expect(__setupSessionTestOnly.inferContextWindowTokens('claude-3-5-sonnet')).toBe(200000)
    expect(__setupSessionTestOnly.inferContextWindowTokens('gpt-4o-mini')).toBe(128000)
    expect(__setupSessionTestOnly.inferContextWindowTokens('gpt-4')).toBe(8192)
    expect(__setupSessionTestOnly.inferContextWindowTokens('gpt-3.5-turbo')).toBe(16385)
    expect(__setupSessionTestOnly.inferContextWindowTokens('o1-preview')).toBe(128000)
    expect(__setupSessionTestOnly.inferContextWindowTokens('unknown-model')).toBe(32768)
  })

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
    const testConnection = vi.fn(async () =>
      okWithContext(['m-a', 'm-b', 'm-c'], {
        'm-a': 32000,
        'm-b': 128000,
        'm-c': 256000,
      }),
    )
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
    expect(state.draft.tierContextWindowTokens).toEqual({ haiku: 32000, sonnet: 128000, opus: 256000 })
    expect(state.draft.model).toBe('m-b')
    expect(state.draft.contextWindowTokens).toBe(128000)
  })

  it('clears stale tier capability metadata when an advanced model is cleared', async () => {
    const testConnection = vi.fn(async () => okWithContext(['known-model'], { 'known-model': 128000 }))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('openai')
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()
    await s.next()

    s.setModel('known-model')
    s.setModelMode('advanced')

    let state = s.getState()
    expect(state.modelTier).toBe('haiku')
    expect(state.draft.tierContextWindowSources).toEqual({
      haiku: 'provider_list',
      sonnet: 'provider_list',
      opus: 'provider_list',
    })

    s.setModel('')

    state = s.getState()
    expect(state.draft.tierModels.haiku).toBe('')
    expect(state.draft.tierContextWindowTokens.haiku).toBe(32768)
    expect(state.draft.tierContextWindowSources).toEqual({
      sonnet: 'provider_list',
      opus: 'provider_list',
    })
    expect(state.draft.tierContextWindowConfidence).toEqual({
      sonnet: 'detected',
      opus: 'detected',
    })
    expect(state.draft.tierContextWindowBindings).toEqual({
      sonnet: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'known-model',
      },
      opus: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'known-model',
      },
    })
  })

  it('quick mode maps one model to all tiers', async () => {
    const testConnection = vi.fn(async () => okWithContext(['m1'], { m1: 64000 }))
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
    expect(draft.tierContextWindowTokens).toEqual({ haiku: 64000, sonnet: 64000, opus: 64000 })
    expect(draft.model).toBe('m1')
    expect(draft.contextWindowTokens).toBe(64000)
  })

  it('recomputes tier context windows when switching advanced -> quick without reselecting model', async () => {
    const testConnection = vi.fn(async () =>
      okWithContext(['m-a', 'm-b', 'm-c'], {
        'm-a': 32000,
        'm-b': 128000,
        'm-c': 256000,
      }),
    )
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
    s.setModel('m-a')
    await s.next()
    s.setModel('m-b')
    await s.next()
    s.setModel('m-c')

    s.setModelMode('quick')
    const draft = s.getState().draft
    expect(draft.model).toBe('m-b')
    expect(draft.tierModels).toEqual({ haiku: 'm-b', sonnet: 'm-b', opus: 'm-b' })
    expect(draft.tierContextWindowTokens).toEqual({ haiku: 128000, sonnet: 128000, opus: 128000 })
    expect(draft.contextWindowTokens).toBe(128000)
  })

  it('maps anthropic vendor presets to baseUrl and supports custom empty URL', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    expect(s.getState().draft.anthropicVendor).toBe('deepseek')
    expect(s.getState().draft.baseUrl).toBe('https://api.deepseek.com/anthropic')

    s.setAnthropicVendor('anthropic')
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

  it('covers additional validation and transition edge branches', async () => {
    const pendingConnection = new Promise<ConnectionTestResult>(() => {})
    const testConnection = vi.fn(async () => pendingConnection)
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    ;(s as any).setAnthropicVendor(null)
    await s.next()
    expect(s.getState().error).toBe('Select a provider')

    s.setAnthropicVendor('anthropic')
    await s.next()
    s.setBaseUrl('')
    await s.next()
    expect(s.getState().error).toBe('Enter a base URL')
    s.setBaseUrl('https://api.anthropic.com/v1')
    await s.next()
    await s.next()
    expect(s.getState().error).toBe('Enter an API key')
    s.setApiKey('sk-test')
    void s.next()
    await Promise.resolve()
    expect(s.getState().step).toBe('test')

    await s.next()
    expect(s.getState().step).toBe('test')
  })

  it('covers advanced-model empty tier and back transitions from write/done', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    await s.next()
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    await s.next()

    s.setModelMode('advanced')
    await s.next()
    await s.next()
    expect(s.getState().error).toContain('Select a model for')

    s.back()
    expect(s.getState().step).toBe('modelMode')

    s.setModelMode('quick')
    await s.next()
    s.setModel('m1')
    await s.next()
    await s.next()
    await s.next()
    expect(s.getState().step).toBe('done')
    s.back()
    expect(s.getState().step).toBe('write')
    s.back()
    expect(s.getState().step).toBe('confirm')
  })

  it('covers runTest missing provider/baseUrl/apiKey branches while in test step', async () => {
    const pendingConnection = new Promise<ConnectionTestResult>(() => {})
    const testConnection = vi.fn(async () => pendingConnection)
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('openai')
    await s.next()
    await s.next()
    s.setApiKey('sk-test')
    void s.next()
    await Promise.resolve()
    expect(s.getState().step).toBe('test')

    ;(s as any).setProvider(null)
    await s.next()
    expect(s.getState().error).toBe('Missing provider')

    s.setProvider('openai')
    s.setBaseUrl('')
    await s.next()
    expect(s.getState().error).toBe('Missing baseUrl')

    s.setBaseUrl('https://api.openai.com/v1')
    ;(s as any).setApiKey(undefined)
    await s.next()
    expect(s.getState().error).toBe('Missing apiKey')
  })

  it('covers provider and model-mode setter edge branches', async () => {
    const testConnection = vi.fn(async () => ok(['m1']))
    const s = createSetupSession({ providers: PROVIDERS, testConnection })

    await s.next()
    s.setProvider('anthropic')
    ;(s as any).setAnthropicVendor(null)
    s.setProvider('anthropic')
    expect(s.getState().draft.anthropicVendor).toBe('deepseek')

    s.setBaseUrl('https://proxy.anthropic.local/v1')
    s.setProvider('anthropic')
    expect(s.getState().draft.baseUrl).toBe('https://proxy.anthropic.local/v1')

    ;(s as any).setAnthropicVendor('unknown-vendor')
    s.setProvider('anthropic')
    expect(s.getState().draft.baseUrl).toBe('https://api.anthropic.com/v1')

    s.setProvider('openai')
    ;(s as any).setAnthropicVendor('custom')
    s.setProvider('anthropic')
    expect(s.getState().draft.baseUrl).toBe('')

    s.setAnthropicVendor('glm')
    s.setBaseUrl('https://relay.example.com/anthropic')
    s.setAnthropicVendor('glm')
    expect(s.getState().draft.baseUrl).toBe('https://relay.example.com/anthropic')

    ;(s as any).setProvider(null)
    ;(s as any).setBaseUrl(undefined)
    expect(s.getState().draft.baseUrl).toBe('')

    s.setProvider('openai')
    s.setBaseUrl('https://api.openai.com/v1')
    s.setApiKey('sk-test')
    await s.next()
    await s.next()

    s.setModelMode('quick')
    s.setModel('m1')
    s.setModelMode('quick')
    expect(s.getState().draft.tierModels).toEqual({ haiku: 'm1', sonnet: 'm1', opus: 'm1' })

    s.setModelMode('advanced')
    expect(s.getState().draft.tierModels).toEqual({ haiku: 'm1', sonnet: 'm1', opus: 'm1' })

    s.setModelMode('quick')
    ;(s as any).setModel(undefined)
    expect(s.getState().draft.model).toBe('')
  })

  it('covers openai back transitions and next fall-through at done', async () => {
    const pendingConnection = new Promise<ConnectionTestResult>(() => {})
    const blockingTestConnection = vi.fn(async () => pendingConnection)
    const s = createSetupSession({ providers: PROVIDERS, testConnection: blockingTestConnection })

    await s.next()
    s.setProvider('openai')
    await s.next()
    expect(s.getState().step).toBe('baseUrl')

    s.back()
    expect(s.getState().step).toBe('provider')

    await s.next()
    await s.next()
    expect(s.getState().step).toBe('apiKey')

    s.back()
    expect(s.getState().step).toBe('baseUrl')

    await s.next()
    s.setApiKey('sk-test')
    void s.next()
    await Promise.resolve()
    expect(s.getState().step).toBe('test')

    s.back()
    expect(s.getState().step).toBe('apiKey')

    const passingTestConnection = vi.fn(async () => ok(['m-haiku', 'm-sonnet', 'm-opus']))
    const s2 = createSetupSession({ providers: PROVIDERS, testConnection: passingTestConnection })

    await s2.next()
    s2.setProvider('openai')
    await s2.next()
    await s2.next()
    s2.setApiKey('sk-test')
    await s2.next()
    expect(s2.getState().step).toBe('modelMode')

    s2.setModelMode('advanced')
    await s2.next()
    s2.setModel('m-haiku')
    await s2.next()
    s2.setModel('m-sonnet')
    await s2.next()
    expect(s2.getState().modelTier).toBe('opus')

    s2.back()
    expect(s2.getState().modelTier).toBe('sonnet')

    s2.setModel('m-sonnet')
    await s2.next()
    s2.setModel('m-opus')
    await s2.next()
    expect(s2.getState().step).toBe('confirm')

    s2.back()
    expect(s2.getState().step).toBe('model')
    expect(s2.getState().modelTier).toBe('opus')

    await s2.next()
    expect(s2.getState().step).toBe('confirm')
    await s2.next()
    expect(s2.getState().step).toBe('write')
    await s2.next()
    expect(s2.getState().step).toBe('done')

    s2.back()
    expect(s2.getState().step).toBe('write')
    s2.back()
    expect(s2.getState().step).toBe('confirm')

    s2.setModelMode('quick')
    s2.back()
    expect(s2.getState().step).toBe('model')

    await s2.next()
    expect(s2.getState().step).toBe('confirm')
    await s2.next()
    expect(s2.getState().step).toBe('write')
    await s2.next()
    expect(s2.getState().step).toBe('done')

    await s2.next()
    expect(s2.getState().step).toBe('done')
  })
})
