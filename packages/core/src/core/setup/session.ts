import type { ModelContextWindowMetadata } from '../../config/modelCapability.js'
import { createModelContextWindowMetadata, normalizeModelIdentity, sameModelIdentity } from '../../config/modelCapability.js'
import { inferContextWindowTokens } from '../../config/modelContextWindow.js'
import type { ModelTier, ProviderId } from '../../config/settings/schema.js'
import type {
  ConnectionTestResult,
  SetupAnthropicVendor,
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
  modelContextWindows: Record<string, number>
  modelContextWindowMetadata: Record<string, ModelContextWindowMetadata>
  modelTier: ModelTier | null
  test: { status: 'idle' | 'running' | 'error'; lastError: ConnectionTestResult | null }
  error: string | null
}

export type SetupSession = {
  getState: () => SetupSessionState
  setProvider: (provider: ProviderId) => void
  setAnthropicVendor: (vendor: SetupAnthropicVendor) => void
  setBaseUrl: (baseUrl: string) => void
  setApiKey: (apiKey: string) => void
  setModelMode: (mode: SetupModelMode) => void
  setModel: (model: string) => void
  setTierModel: (tier: ModelTier, model: string) => void
  setTierContextWindowTokens: (tier: ModelTier, tokens: number | null) => void
  back: () => void
  next: () => Promise<void>
}

const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}
const ANTHROPIC_VENDOR_BASE_URL: Record<Exclude<SetupAnthropicVendor, 'custom'>, string> = {
  deepseek: 'https://api.deepseek.com/anthropic',
  anthropic: 'https://api.anthropic.com/v1',
  glm: 'https://open.bigmodel.cn/api/anthropic',
  kimi: 'https://api.moonshot.cn/anthropic',
  minimax: 'https://api.minimax.io/anthropic',
}

const ADVANCED_MODEL_TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus']
function createEmptyTierModels(): SetupTierModels {
  return { haiku: '', sonnet: '', opus: '' }
}

function createDefaultTierContextWindows(): Record<ModelTier, number> {
  return { haiku: 32768, sonnet: 32768, opus: 32768 }
}

function pickTierModel(current: string, seed: string): string {
  const trimmed = String(current || '').trim()
  return trimmed.length > 0 ? trimmed : seed
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
      anthropicVendor: null,
      baseUrl: '',
      apiKey: '',
      modelMode: 'quick',
      model: '',
      tierModels: createEmptyTierModels(),
      tierContextWindowTokens: createDefaultTierContextWindows(),
      contextWindowTokens: undefined,
    },
    providers: args.providers,
    availableModels: [],
    modelContextWindows: {},
    modelContextWindowMetadata: {},
    modelTier: null,
    test: { status: 'idle', lastError: null },
    error: null,
  }

  const getCurrentModelTier = (): ModelTier | null => {
    if (state.step !== 'model') return null
    if (state.draft.modelMode !== 'advanced') return null
    return ADVANCED_MODEL_TIERS[Math.max(0, Math.min(modelTierIndex, ADVANCED_MODEL_TIERS.length - 1))]
  }

  const syncModelTierState = () => {
    state.modelTier = getCurrentModelTier()
  }

  const resetTest = () => {
    state.availableModels = []
    state.modelContextWindows = {}
    state.modelContextWindowMetadata = {}
    state.test = { status: 'idle', lastError: null }
    modelTierIndex = 0
    syncModelTierState()
  }

  const resetModelSelection = () => {
    state.draft.modelMode = 'quick'
    state.draft.model = ''
    state.draft.tierModels = createEmptyTierModels()
    state.draft.tierContextWindowTokens = createDefaultTierContextWindows()
    state.draft.tierContextWindowSources = undefined
    state.draft.tierContextWindowConfidence = undefined
    state.draft.tierContextWindowBindings = undefined
    state.draft.tierContextWindowManualClears = undefined
    state.draft.contextWindowTokens = undefined
    state.draft.contextWindowBinding = undefined
    modelTierIndex = 0
    syncModelTierState()
  }

  const getMetadataForModel = (model: string): ModelContextWindowMetadata | null => {
    const key = String(model || '').trim()
    if (!key) return null
    const existing = state.modelContextWindowMetadata[key]
    if (existing) return existing
    const detected = state.modelContextWindows[key]
    if (Number.isFinite(detected) && detected > 0 && state.draft.provider) {
      return createModelContextWindowMetadata({
        provider: state.draft.provider,
        baseUrl: state.draft.baseUrl,
        model: key,
        tokens: detected,
        source: 'provider_list',
        confidence: 'detected',
      })
    }
    if (!state.draft.provider) return null
    return createModelContextWindowMetadata({
      provider: state.draft.provider,
      baseUrl: state.draft.baseUrl,
      model: key,
      tokens: inferContextWindowTokens(key),
      source: 'heuristic',
      confidence: 'heuristic',
    })
  }

  const applyMetadataToTier = (tier: ModelTier, metadata: ModelContextWindowMetadata | null) => {
    if (!metadata) return
    state.draft.tierContextWindowTokens = {
      ...state.draft.tierContextWindowTokens,
      [tier]: metadata.tokens,
    }
    state.draft.tierContextWindowSources = {
      ...(state.draft.tierContextWindowSources || {}),
      [tier]: metadata.source,
    }
    state.draft.tierContextWindowConfidence = {
      ...(state.draft.tierContextWindowConfidence || {}),
      [tier]: metadata.confidence,
    }
    state.draft.tierContextWindowBindings = {
      ...(state.draft.tierContextWindowBindings || {}),
      [tier]: metadata.binding,
    }
  }

  const clearMetadataForTier = (tier: ModelTier) => {
    const nextSources = state.draft.tierContextWindowSources ? { ...state.draft.tierContextWindowSources } : undefined
    const nextConfidence = state.draft.tierContextWindowConfidence
      ? { ...state.draft.tierContextWindowConfidence }
      : undefined
    const nextBindings = state.draft.tierContextWindowBindings ? { ...state.draft.tierContextWindowBindings } : undefined
    if (nextSources) delete nextSources[tier]
    if (nextConfidence) delete nextConfidence[tier]
    if (nextBindings) delete nextBindings[tier]
    state.draft.tierContextWindowSources = nextSources && Object.keys(nextSources).length > 0 ? nextSources : undefined
    state.draft.tierContextWindowConfidence =
      nextConfidence && Object.keys(nextConfidence).length > 0 ? nextConfidence : undefined
    state.draft.tierContextWindowBindings =
      nextBindings && Object.keys(nextBindings).length > 0 ? nextBindings : undefined
  }

  const clearManualClearForTier = (tier: ModelTier) => {
    const nextClears = state.draft.tierContextWindowManualClears
      ? { ...state.draft.tierContextWindowManualClears }
      : undefined
    if (!nextClears) return
    delete nextClears[tier]
    state.draft.tierContextWindowManualClears = Object.keys(nextClears).length > 0 ? nextClears : undefined
  }

  const markManualClearForTier = (tier: ModelTier, model: string) => {
    const key = String(model || '').trim()
    if (!key || !state.draft.provider) return
    const binding = normalizeModelIdentity({
      provider: state.draft.provider,
      baseUrl: state.draft.baseUrl,
      model: key,
    })
    state.draft.tierContextWindowManualClears = {
      ...(state.draft.tierContextWindowManualClears || {}),
      [tier]: binding,
    }
  }

  const getDraftMetadataForTier = (tier: ModelTier, model: string): ModelContextWindowMetadata | null => {
    const key = String(model || '').trim()
    if (!key || !state.draft.provider) return null
    const tokens = state.draft.tierContextWindowTokens[tier]
    const source = state.draft.tierContextWindowSources?.[tier]
    const confidence = state.draft.tierContextWindowConfidence?.[tier]
    const binding = state.draft.tierContextWindowBindings?.[tier]
    if (!Number.isFinite(tokens) || !tokens || !source || !confidence || !binding) return null
    if (!sameModelIdentity(binding, { provider: state.draft.provider, baseUrl: state.draft.baseUrl, model: key })) {
      return null
    }
    return { tokens, source, confidence, binding }
  }

  const createManualMetadata = (model: string, tokens: number): ModelContextWindowMetadata | null => {
    const key = String(model || '').trim()
    if (!key || !state.draft.provider) return null
    return createModelContextWindowMetadata({
      provider: state.draft.provider,
      baseUrl: state.draft.baseUrl,
      model: key,
      tokens,
      source: 'manual',
      confidence: 'detected',
    })
  }

  const applyAutomaticMetadataToTier = (tier: ModelTier) => {
    const model = state.draft.tierModels[tier] || (tier === 'sonnet' ? state.draft.model : '')
    const metadata = getMetadataForModel(model)
    state.draft.tierContextWindowTokens = {
      ...state.draft.tierContextWindowTokens,
      [tier]: metadata?.tokens ?? inferContextWindowTokens(model),
    }
    if (metadata) applyMetadataToTier(tier, metadata)
    else clearMetadataForTier(tier)
    if (tier === 'sonnet') updateDraftContextWindow(state.draft.model)
  }

  const updateDraftContextWindow = (model: string) => {
    const key = String(model || '').trim()
    if (!key) {
      state.draft.contextWindowTokens = undefined
      state.draft.contextWindowBinding = undefined
      return
    }
    const metadata = getMetadataForModel(key)
    state.draft.contextWindowTokens = metadata?.tokens ?? inferContextWindowTokens(key)
    state.draft.contextWindowBinding = metadata?.binding
  }

  const syncDraftContextWindowFromSonnetTier = () => {
    const metadata = getDraftMetadataForTier('sonnet', state.draft.model)
    if (metadata) {
      state.draft.contextWindowTokens = metadata.tokens
      state.draft.contextWindowBinding = metadata.binding
      return
    }
    updateDraftContextWindow(state.draft.model)
  }

  const inferWindowForModel = (model: string): number => {
    return getMetadataForModel(model)?.tokens ?? inferContextWindowTokens(model)
  }

  const setError = (message: string | null) => {
    state.error = message ? String(message) : null
  }

  const setProvider = (provider: ProviderId) => {
    const prevProvider = state.draft.provider
    state.draft.provider = provider
    if (provider === 'anthropic') {
      if (!state.draft.anthropicVendor) state.draft.anthropicVendor = 'deepseek'
      const vendor = state.draft.anthropicVendor
      const hasExisting = state.draft.baseUrl.trim().length > 0
      if (prevProvider === 'anthropic' && hasExisting) {
        state.draft.baseUrl = normalizeBaseUrl(provider, state.draft.baseUrl)
      } else {
        state.draft.baseUrl =
          vendor === 'custom'
            ? ''
            : normalizeBaseUrl(provider, ANTHROPIC_VENDOR_BASE_URL[vendor] || DEFAULT_BASE_URL[provider])
      }
    } else {
      state.draft.anthropicVendor = null
      const hasExisting = state.draft.baseUrl.trim().length > 0
      if (prevProvider === provider && hasExisting) {
        state.draft.baseUrl = normalizeBaseUrl(provider, state.draft.baseUrl)
      } else {
        state.draft.baseUrl = normalizeBaseUrl(provider, DEFAULT_BASE_URL[provider])
      }
    }
    resetModelSelection()
    resetTest()
    setError(null)
  }

  const setAnthropicVendor = (vendor: SetupAnthropicVendor) => {
    const prevVendor = state.draft.anthropicVendor
    const hasExisting = state.draft.baseUrl.trim().length > 0
    state.draft.anthropicVendor = vendor
    if (vendor === 'custom') {
      if (prevVendor === 'custom' && hasExisting) {
        state.draft.baseUrl = normalizeBaseUrl('anthropic', state.draft.baseUrl)
      } else {
        state.draft.baseUrl = ''
      }
    } else {
      if (prevVendor === vendor && hasExisting) {
        state.draft.baseUrl = normalizeBaseUrl('anthropic', state.draft.baseUrl)
      } else {
        state.draft.baseUrl = normalizeBaseUrl('anthropic', ANTHROPIC_VENDOR_BASE_URL[vendor])
      }
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
      let quickModel = state.draft.model.trim()
      let quickSourceTier: ModelTier = 'sonnet'
      if (!quickModel) {
        quickModel = tierModels.sonnet.trim()
        quickSourceTier = 'sonnet'
      }
      if (!quickModel) {
        quickModel = tierModels.haiku.trim()
        quickSourceTier = 'haiku'
      }
      if (!quickModel) {
        quickModel = tierModels.opus.trim()
        quickSourceTier = 'opus'
      }
      if (quickModel) {
        state.draft.model = quickModel
        state.draft.tierModels = { haiku: quickModel, sonnet: quickModel, opus: quickModel }
        const metadata = getDraftMetadataForTier(quickSourceTier, quickModel) ?? getMetadataForModel(quickModel)
        const windowTokens = metadata?.tokens ?? inferContextWindowTokens(quickModel)
        state.draft.tierContextWindowTokens = { haiku: windowTokens, sonnet: windowTokens, opus: windowTokens }
        state.draft.tierContextWindowSources = metadata
          ? { haiku: metadata.source, sonnet: metadata.source, opus: metadata.source }
          : undefined
        state.draft.tierContextWindowConfidence = metadata
          ? { haiku: metadata.confidence, sonnet: metadata.confidence, opus: metadata.confidence }
          : undefined
        state.draft.tierContextWindowBindings = metadata
          ? { haiku: metadata.binding, sonnet: metadata.binding, opus: metadata.binding }
          : undefined
      } else {
        state.draft.model = ''
        state.draft.tierModels = createEmptyTierModels()
        state.draft.tierContextWindowTokens = createDefaultTierContextWindows()
        state.draft.tierContextWindowSources = undefined
        state.draft.tierContextWindowConfidence = undefined
        state.draft.tierContextWindowBindings = undefined
      }
    } else {
      const seed = state.draft.model.trim()
      if (seed) {
        state.draft.tierModels = {
          haiku: pickTierModel(tierModels.haiku, seed),
          sonnet: pickTierModel(tierModels.sonnet, seed),
          opus: pickTierModel(tierModels.opus, seed),
        }
        const metadata = getDraftMetadataForTier('sonnet', seed) ?? getMetadataForModel(seed)
        if (metadata) {
          state.draft.tierContextWindowTokens = {
            haiku: metadata.tokens,
            sonnet: metadata.tokens,
            opus: metadata.tokens,
          }
          state.draft.tierContextWindowSources = {
            haiku: metadata.source,
            sonnet: metadata.source,
            opus: metadata.source,
          }
          state.draft.tierContextWindowConfidence = {
            haiku: metadata.confidence,
            sonnet: metadata.confidence,
            opus: metadata.confidence,
          }
          state.draft.tierContextWindowBindings = {
            haiku: metadata.binding,
            sonnet: metadata.binding,
            opus: metadata.binding,
          }
        }
      }
      state.draft.model = state.draft.tierModels.sonnet.trim()
    }

    modelTierIndex = 0
    syncDraftContextWindowFromSonnetTier()
    syncModelTierState()
    setError(null)
  }

  const applyAdvancedTierModel = (tier: ModelTier, model: string) => {
    const value = String(model || '').trim()
    state.draft.tierModels = { ...state.draft.tierModels, [tier]: value }
    const metadata = getMetadataForModel(value)
    state.draft.tierContextWindowTokens = {
      ...state.draft.tierContextWindowTokens,
      [tier]: metadata?.tokens ?? inferContextWindowTokens(value),
    }
    if (metadata) applyMetadataToTier(tier, metadata)
    else clearMetadataForTier(tier)
    if (tier === 'sonnet') {
      state.draft.model = value
      updateDraftContextWindow(state.draft.model)
    }
  }

  const setModel = (model: string) => {
    const value = String(model || '').trim()
    if (state.draft.modelMode === 'quick') {
      state.draft.model = value
      state.draft.tierModels = { haiku: value, sonnet: value, opus: value }
      const metadata = getMetadataForModel(value)
      const windowTokens = metadata?.tokens ?? inferContextWindowTokens(value)
      state.draft.tierContextWindowTokens = { haiku: windowTokens, sonnet: windowTokens, opus: windowTokens }
      state.draft.tierContextWindowSources = metadata
        ? { haiku: metadata.source, sonnet: metadata.source, opus: metadata.source }
        : undefined
      state.draft.tierContextWindowConfidence = metadata
        ? { haiku: metadata.confidence, sonnet: metadata.confidence, opus: metadata.confidence }
        : undefined
      state.draft.tierContextWindowBindings = metadata
        ? { haiku: metadata.binding, sonnet: metadata.binding, opus: metadata.binding }
        : undefined
      updateDraftContextWindow(state.draft.model)
    } else {
      const tier = ADVANCED_MODEL_TIERS[Math.max(0, Math.min(modelTierIndex, ADVANCED_MODEL_TIERS.length - 1))]
      applyAdvancedTierModel(tier, value)
    }
    setError(null)
  }

  const setTierModel = (tier: ModelTier, model: string) => {
    if (!ADVANCED_MODEL_TIERS.includes(tier)) return
    applyAdvancedTierModel(tier, model)
    setError(null)
  }

  const setTierContextWindowTokens = (tier: ModelTier, tokens: number | null) => {
    if (!ADVANCED_MODEL_TIERS.includes(tier)) return
    if (tokens == null) {
      if (state.draft.modelMode === 'quick') {
        const model = state.draft.model.trim()
        const metadata = getMetadataForModel(model)
        const windowTokens = metadata?.tokens ?? inferContextWindowTokens(model)
        state.draft.tierContextWindowTokens = { haiku: windowTokens, sonnet: windowTokens, opus: windowTokens }
        state.draft.tierContextWindowSources = metadata
          ? { haiku: metadata.source, sonnet: metadata.source, opus: metadata.source }
          : undefined
        state.draft.tierContextWindowConfidence = metadata
          ? { haiku: metadata.confidence, sonnet: metadata.confidence, opus: metadata.confidence }
          : undefined
        state.draft.tierContextWindowBindings = metadata
          ? { haiku: metadata.binding, sonnet: metadata.binding, opus: metadata.binding }
          : undefined
        markManualClearForTier('haiku', model)
        markManualClearForTier('sonnet', model)
        markManualClearForTier('opus', model)
        updateDraftContextWindow(model)
        setError(null)
        return
      }
      const model = state.draft.tierModels[tier] || (tier === 'sonnet' ? state.draft.model : '')
      applyAutomaticMetadataToTier(tier)
      markManualClearForTier(tier, model)
      setError(null)
      return
    }
    if (!Number.isFinite(tokens) || !Number.isInteger(tokens) || tokens <= 0) {
      setError('Enter a positive integer context window')
      return
    }
    const model = state.draft.tierModels[tier] || (tier === 'sonnet' ? state.draft.model : '')
    const metadata = createManualMetadata(model, tokens)
    if (!metadata) {
      setError(`Select a model for ${tier}`)
      return
    }
    applyMetadataToTier(tier, metadata)
    if (state.draft.modelMode === 'quick') {
      state.draft.tierContextWindowTokens = { haiku: tokens, sonnet: tokens, opus: tokens }
      state.draft.tierContextWindowSources = { haiku: 'manual', sonnet: 'manual', opus: 'manual' }
      state.draft.tierContextWindowConfidence = { haiku: 'detected', sonnet: 'detected', opus: 'detected' }
      state.draft.tierContextWindowBindings = {
        haiku: metadata.binding,
        sonnet: metadata.binding,
        opus: metadata.binding,
      }
      clearManualClearForTier('haiku')
      clearManualClearForTier('sonnet')
      clearManualClearForTier('opus')
    } else {
      clearManualClearForTier(tier)
    }
    if (tier === 'sonnet') {
      state.draft.contextWindowTokens = tokens
      state.draft.contextWindowBinding = metadata.binding
    }
    setError(null)
  }

  const back = () => {
    setError(null)
    if (state.step === 'welcome') return

    switch (state.step) {
      case 'provider':
        state.step = 'welcome'
        break
      case 'anthropicVendor':
        state.step = 'provider'
        break
      case 'baseUrl':
        state.step = state.draft.provider === 'anthropic' ? 'anthropicVendor' : 'provider'
        break
      case 'apiKey':
        state.step = 'baseUrl'
        break
      case 'test':
      case 'modelMode':
        state.step = 'apiKey'
        break
      case 'model':
        if (state.draft.modelMode === 'advanced' && modelTierIndex > 0) {
          modelTierIndex -= 1
        } else {
          state.step = 'modelMode'
          modelTierIndex = 0
        }
        break
      case 'confirm':
        state.step = 'model'
        if (state.draft.modelMode === 'advanced') modelTierIndex = ADVANCED_MODEL_TIERS.length - 1
        break
      case 'write':
        state.step = 'confirm'
        break
      case 'done':
        state.step = 'write'
        break
    }
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
      state.modelContextWindows = { ...(res.modelContextWindows || {}) }
      state.modelContextWindowMetadata = { ...(res.modelContextWindowMetadata || {}) }
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
      if (state.draft.provider === 'anthropic') {
        state.step = 'anthropicVendor'
        return
      }
      state.step = 'baseUrl'
      return
    }

    if (state.step === 'anthropicVendor') {
      if (!state.draft.anthropicVendor) {
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
      if (!state.draft.tierModels[tier].trim()) {
        setError(`Select a model for ${tier}`)
        return
      }
      if (modelTierIndex < ADVANCED_MODEL_TIERS.length - 1) {
        modelTierIndex += 1
        syncModelTierState()
        return
      }

      state.draft.model = state.draft.tierModels.sonnet.trim()
      syncDraftContextWindowFromSonnetTier()
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
    setAnthropicVendor,
    setBaseUrl,
    setApiKey,
    setModelMode,
    setModel,
    setTierModel,
    setTierContextWindowTokens,
    back,
    next,
  }
}

export const __setupSessionTestOnly = {
  createEmptyTierModels,
  createDefaultTierContextWindows,
  pickTierModel,
  normalizeBaseUrl,
  inferContextWindowTokens,
}
