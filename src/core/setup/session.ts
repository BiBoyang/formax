import type { ProviderId } from '../config/schema.js'
import { ErrorCode } from '../errors/codes.js'
import type { ConnectionTestResult, SetupDraft, SetupProviderOption, SetupStep } from './types.js'

export type ConnectionTester = (input: { provider: ProviderId; baseUrl: string; apiKey: string }) => Promise<ConnectionTestResult>

export type SetupSessionState = {
  step: SetupStep
  draft: SetupDraft
  providers: SetupProviderOption[]
  availableModels: string[]
  test: { status: 'idle' | 'running' | 'error'; lastError: ConnectionTestResult | null }
  error: string | null
}

export type SetupSession = {
  getState: () => SetupSessionState
  setProvider: (provider: ProviderId) => void
  setBaseUrl: (baseUrl: string) => void
  setApiKey: (apiKey: string) => void
  setModel: (model: string) => void
  back: () => void
  next: () => Promise<void>
}

const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

function normalizeBaseUrl(provider: ProviderId, input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')

  if (provider === 'anthropic' || provider === 'openai') {
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
  }

  return trimmed
}

export function createSetupSession(args: {
  providers: SetupProviderOption[]
  testConnection: ConnectionTester
}): SetupSession {
  const state: SetupSessionState = {
    step: 'welcome',
    draft: { provider: null, baseUrl: '', apiKey: '', model: '' },
    providers: args.providers,
    availableModels: [],
    test: { status: 'idle', lastError: null },
    error: null,
  }

  const resetTest = () => {
    state.availableModels = []
    state.test = { status: 'idle', lastError: null }
  }

  const setError = (message: string | null) => {
    state.error = message ? String(message) : null
  }

  const setProvider = (provider: ProviderId) => {
    state.draft.provider = provider
    if (!state.draft.baseUrl.trim()) {
      state.draft.baseUrl = DEFAULT_BASE_URL[provider]
    } else {
      state.draft.baseUrl = normalizeBaseUrl(provider, state.draft.baseUrl)
    }
    state.draft.model = ''
    resetTest()
    setError(null)
  }

  const setBaseUrl = (baseUrl: string) => {
    const provider = state.draft.provider
    state.draft.baseUrl = provider ? normalizeBaseUrl(provider, baseUrl) : String(baseUrl || '').trim()
    state.draft.model = ''
    resetTest()
    setError(null)
  }

  const setApiKey = (apiKey: string) => {
    state.draft.apiKey = String(apiKey || '').trim()
    state.draft.model = ''
    resetTest()
    setError(null)
  }

  const setModel = (model: string) => {
    state.draft.model = String(model || '').trim()
    setError(null)
  }

  const back = () => {
    setError(null)
    if (state.step === 'welcome') return
    if (state.step === 'provider') state.step = 'welcome'
    else if (state.step === 'baseUrl') state.step = 'provider'
    else if (state.step === 'apiKey') state.step = 'baseUrl'
    else if (state.step === 'test') state.step = 'apiKey'
    else if (state.step === 'model') state.step = 'apiKey'
    else if (state.step === 'confirm') state.step = 'model'
    else if (state.step === 'write') state.step = 'confirm'
    else if (state.step === 'done') state.step = 'write'
  }

  const runTest = async () => {
    const provider = state.draft.provider
    if (!provider) {
      setError('Missing provider')
      return
    }
    const baseUrl = state.draft.baseUrl.trim()
    if (!baseUrl) {
      setError('Missing baseUrl')
      return
    }
    const apiKey = state.draft.apiKey.trim()
    if (!apiKey) {
      setError('Missing apiKey')
      return
    }

    state.test = { status: 'running', lastError: null }
    let res: ConnectionTestResult
    try {
      res = await args.testConnection({ provider, baseUrl, apiKey })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res = { ok: false, code: ErrorCode.Unknown, message }
    }
    if (res.ok === true) {
      state.availableModels = res.models
      state.test = { status: 'idle', lastError: null }
      state.step = 'model'
      setError(null)
      return
    }

    state.test = { status: 'error', lastError: res }
    setError(res.message)
  }

  const next = async () => {
    setError(null)

    if (state.step === 'welcome') {
      state.step = 'provider'
      return
    }

    if (state.step === 'provider') {
      if (!state.draft.provider) {
        setError('Select a provider')
        return
      }
      state.step = 'baseUrl'
      return
    }

    if (state.step === 'baseUrl') {
      if (!state.draft.baseUrl.trim()) {
        setError('Enter a base URL')
        return
      }
      state.step = 'apiKey'
      return
    }

    if (state.step === 'apiKey') {
      if (!state.draft.apiKey.trim()) {
        setError('Enter an API key')
        return
      }
      state.step = 'test'
      await runTest()
      return
    }

    if (state.step === 'test') {
      if (state.test.status === 'running') return
      await runTest()
      return
    }

    if (state.step === 'model') {
      if (!state.draft.model.trim()) {
        setError('Select a model')
        return
      }
      state.step = 'confirm'
      return
    }

    if (state.step === 'confirm') {
      state.step = 'write'
      return
    }

    if (state.step === 'write') {
      state.step = 'done'
      return
    }
  }

  return {
    getState: () => structuredClone(state),
    setProvider,
    setBaseUrl,
    setApiKey,
    setModel,
    back,
    next,
  }
}
