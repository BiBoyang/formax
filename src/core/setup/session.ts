import type { ModelTier, ProviderId } from '../config/schema.js'
import type {
  ConnectionTestResult,
  SetupDraft,
  SetupModelMode,
  SetupProviderOption,
  SetupStep,
  SetupTierModels,
} from './types.js'
import { mapUnknownError } from './errorMapping.js'

export type ConnectionTester = (input: { provider: ProviderId; baseUrl: string; apiKey: string }) => Promise<ConnectionTestResult>

export type SetupSessionState = {
  step: SetupStep
  draft: SetupDraft
  providers: SetupProviderOption[]
  availableModels: string[]
  modelTier: ModelTier | null
  test: { status: 'idle' | 'running' | 'error'; lastError: ConnectionTestResult | null }
  error: string | null
}

export type SetupSession = {
  getState: () => SetupSessionState
  setProvider: (provider: ProviderId) => void
  setBaseUrl: (baseUrl: string) => void
  setApiKey: (apiKey: string) => void
  setModelMode: (mode: SetupModelMode) => void
  setModel: (model: string) => void
  back: () => void
  next: () => Promise<void>
}

const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

const ADVANCED_MODEL_TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus']

function createEmptyTierModels(): SetupTierModels {
  return { haiku: '', sonnet: '', opus: '' }
}

function normalizeBaseUrl(_provider: ProviderId, input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed
}

export function createSetupSession(args: {
  providers: SetupProviderOption[]
  testConnection: ConnectionTester
}): SetupSession {
  let modelTierIndex = 0

  const state: SetupSessionState = {
    step: 'welcome',
    draft: {
      provider: null,
      baseUrl: '',
      apiKey: '',
      modelMode: 'quick',
      model: '',
      tierModels: createEmptyTierModels(),
    },
    providers: args.providers,
    availableModels: [],
    modelTier: null,
    test: { status: 'idle', lastError: null },
    error: null,
  }

  const getCurrentModelTier = (): ModelTier | null => {
    if (state.step !== 'model') return null
    if (state.draft.modelMode !== 'advanced') return null
    return ADVANCED_MODEL_TIERS[Math.max(0, Math.min(modelTierIndex, ADVANCED_MODEL_TIERS.length - 1))] ?? null
  }

  const syncModelTierState = () => {
    state.modelTier = getCurrentModelTier()
  }

  const resetTest = () => {
    state.availableModels = []
    state.test = { status: 'idle', lastError: null }
    modelTierIndex = 0
    syncModelTierState()
  }

  const resetModelSelection = () => {
    state.draft.modelMode = 'quick'
    state.draft.model = ''
    state.draft.tierModels = createEmptyTierModels()
    modelTierIndex = 0
    syncModelTierState()
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
    resetModelSelection()
    resetTest()
    setError(null)
  }

  const setBaseUrl = (baseUrl: string) => {
    const provider = state.draft.provider
    state.draft.baseUrl = provider ? normalizeBaseUrl(provider, baseUrl) : String(baseUrl || '').trim()
    resetModelSelection()
    resetTest()
    setError(null)
  }

  const setApiKey = (apiKey: string) => {
    state.draft.apiKey = String(apiKey || '').trim()
    resetModelSelection()
    resetTest()
    setError(null)
  }

  const setModelMode = (mode: SetupModelMode) => {
    const nextMode: SetupModelMode = mode === 'advanced' ? 'advanced' : 'quick'
    state.draft.modelMode = nextMode

    const tierModels = { ...state.draft.tierModels }
    if (nextMode === 'quick') {
      const quickModel =
        state.draft.model.trim() || tierModels.sonnet.trim() || tierModels.haiku.trim() || tierModels.opus.trim()
      if (quickModel) {
        state.draft.model = quickModel
        state.draft.tierModels = { haiku: quickModel, sonnet: quickModel, opus: quickModel }
      } else {
        state.draft.model = ''
        state.draft.tierModels = createEmptyTierModels()
      }
    } else {
      const seed = state.draft.model.trim()
      if (seed) {
        state.draft.tierModels = {
          haiku: tierModels.haiku.trim() || seed,
          sonnet: tierModels.sonnet.trim() || seed,
          opus: tierModels.opus.trim() || seed,
        }
      }
      state.draft.model = state.draft.tierModels.sonnet.trim()
    }

    modelTierIndex = 0
    syncModelTierState()
    setError(null)
  }

  const setModel = (model: string) => {
    const value = String(model || '').trim()
    if (state.draft.modelMode === 'quick') {
      state.draft.model = value
      state.draft.tierModels = { haiku: value, sonnet: value, opus: value }
    } else {
      const tier = ADVANCED_MODEL_TIERS[Math.max(0, Math.min(modelTierIndex, ADVANCED_MODEL_TIERS.length - 1))]
      if (tier) {
        state.draft.tierModels = { ...state.draft.tierModels, [tier]: value }
        if (tier === 'sonnet') state.draft.model = value
      }
    }
    setError(null)
  }

  const back = () => {
    setError(null)
    if (state.step === 'welcome') return
    if (state.step === 'provider') state.step = 'welcome'
    else if (state.step === 'baseUrl') state.step = 'provider'
    else if (state.step === 'apiKey') state.step = 'baseUrl'
    else if (state.step === 'test') state.step = 'apiKey'
    else if (state.step === 'modelMode') state.step = 'apiKey'
    else if (state.step === 'model') {
      if (state.draft.modelMode === 'advanced' && modelTierIndex > 0) {
        modelTierIndex -= 1
      } else {
        state.step = 'modelMode'
        modelTierIndex = 0
      }
    } else if (state.step === 'confirm') {
      state.step = 'model'
      if (state.draft.modelMode === 'advanced') modelTierIndex = ADVANCED_MODEL_TIERS.length - 1
    } else if (state.step === 'write') state.step = 'confirm'
    else if (state.step === 'done') state.step = 'write'
    syncModelTierState()
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
      const mapped = mapUnknownError(err)
      res = { ok: false, code: mapped.code, message: mapped.message }
    }
    if (res.ok === true) {
      state.availableModels = res.models
      state.test = { status: 'idle', lastError: null }
      state.step = 'modelMode'
      modelTierIndex = 0
      syncModelTierState()
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

    if (state.step === 'modelMode') {
      modelTierIndex = 0
      state.step = 'model'
      syncModelTierState()
      return
    }

    if (state.step === 'model') {
      if (state.draft.modelMode === 'quick') {
        if (!state.draft.model.trim()) {
          setError('Select a model')
          return
        }
        state.step = 'confirm'
        syncModelTierState()
        return
      }

      const tier = ADVANCED_MODEL_TIERS[Math.max(0, Math.min(modelTierIndex, ADVANCED_MODEL_TIERS.length - 1))]
      if (!tier || !state.draft.tierModels[tier].trim()) {
        setError(`Select a model for ${tier ?? 'this tier'}`)
        return
      }

      if (modelTierIndex < ADVANCED_MODEL_TIERS.length - 1) {
        modelTierIndex += 1
        syncModelTierState()
        return
      }

      state.draft.model = state.draft.tierModels.sonnet.trim()
      state.step = 'confirm'
      syncModelTierState()
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
    setModelMode,
    setModel,
    back,
    next,
  }
}
