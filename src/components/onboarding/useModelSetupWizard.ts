import { useReducer, useCallback } from 'react'
import { getActiveModelProfile, type GlobalConfig, type ModelConfig } from '../../utils/config'
import type { ProviderKey } from '../../constants/providers'

// Wizard screens
export type WizardScreen =
  | 'provider'
  | 'partnerProviders'
  | 'partnerCodingPlans'
  | 'baseUrl'
  | 'apiKey'
  | 'resourceName'
  | 'model'
  | 'modelInput'
  | 'modelParams'
  | 'contextLength'
  | 'connectionTest'
  | 'confirmation'

// Wizard state
export type WizardState = {
  screen: WizardScreen
  selectedProvider: ProviderKey
  customBaseUrl: string
  providerBaseUrl: string
  apiKey: string
  resourceName: string
  selectedModel: string
  customModelName: string
  maxTokens: string
  selectedMaxTokensPreset: number
  contextLength: number
  reasoningEffort: 'low' | 'medium' | 'high' | null
  supportsReasoningEffort: boolean
  // UI state
  partnerProviderFocusIndex: number
  codingPlanFocusIndex: number
  activeFieldIndex: number
  // Loading/error state
  isLoadingModels: boolean
  modelLoadError: string | null
  isTestingConnection: boolean
  connectionTestResult: {
    success: boolean
    message: string
    endpoint?: string
    details?: string
  } | null
  validationError: string | null
  apiKeyCleanedNotification: boolean
}

// Wizard actions
export type WizardAction =
  | { type: 'SET_SCREEN'; screen: WizardScreen }
  | { type: 'GO_BACK' }
  | { type: 'SET_PROVIDER'; provider: ProviderKey }
  | { type: 'SET_CUSTOM_BASE_URL'; url: string }
  | { type: 'SET_PROVIDER_BASE_URL'; url: string }
  | { type: 'SET_API_KEY'; key: string }
  | { type: 'SET_RESOURCE_NAME'; name: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_CUSTOM_MODEL'; model: string }
  | { type: 'SET_MAX_TOKENS'; tokens: string; preset: number }
  | { type: 'SET_CONTEXT_LENGTH'; length: number }
  | { type: 'SET_REASONING_EFFORT'; effort: 'low' | 'medium' | 'high' | null }
  | { type: 'SET_SUPPORTS_REASONING_EFFORT'; supports: boolean }
  | { type: 'SET_LOADING_MODELS'; loading: boolean }
  | { type: 'SET_MODEL_LOAD_ERROR'; error: string | null }
  | { type: 'SET_TESTING_CONNECTION'; testing: boolean }
  | { type: 'SET_CONNECTION_TEST_RESULT'; result: WizardState['connectionTestResult'] }
  | { type: 'SET_VALIDATION_ERROR'; error: string | null }
  | { type: 'SET_API_KEY_CLEANED_NOTIFICATION'; show: boolean }
  | { type: 'SET_PARTNER_PROVIDER_FOCUS'; index: number }
  | { type: 'SET_CODING_PLAN_FOCUS'; index: number }
  | { type: 'SET_ACTIVE_FIELD'; index: number }

const DEFAULT_CONTEXT_LENGTH = 128000
const DEFAULT_MAX_TOKENS = 8192

export function getInitialState(config: GlobalConfig): WizardState {
  const activeProfile = getActiveModelProfile(config)
  const legacyModel: ModelConfig | undefined = config.model
  const initialProvider = (activeProfile?.provider as ProviderKey) || (legacyModel?.provider as ProviderKey) || 'anthropic'
  const initialBaseUrl =
    activeProfile?.baseURL ||
    legacyModel?.baseURL ||
    ''
  const initialApiKey = activeProfile?.apiKey || legacyModel?.apiKey || ''
  const initialModelName = activeProfile?.modelName || legacyModel?.name || ''
  const initialMaxTokens =
    activeProfile?.maxTokens ??
    legacyModel?.maxTokens ??
    DEFAULT_MAX_TOKENS
  const initialContextLength =
    activeProfile?.contextLength ??
    legacyModel?.contextLength ??
    DEFAULT_CONTEXT_LENGTH
  const initialReasoningEffort =
    (activeProfile?.reasoningEffort as 'low' | 'medium' | 'high' | null | undefined) ??
    (legacyModel?.reasoningEffort as 'low' | 'medium' | 'high' | null | undefined) ??
    null

  return {
    screen: 'provider',
    selectedProvider: initialProvider,
    customBaseUrl: '',
    providerBaseUrl: initialBaseUrl,
    apiKey: initialApiKey,
    resourceName: '',
    selectedModel: initialModelName,
    customModelName: '',
    maxTokens: initialMaxTokens.toString(),
    selectedMaxTokensPreset: initialMaxTokens,
    contextLength: initialContextLength,
    reasoningEffort: initialReasoningEffort,
    supportsReasoningEffort: false,
    partnerProviderFocusIndex: 0,
    codingPlanFocusIndex: 0,
    activeFieldIndex: 0,
    isLoadingModels: false,
    modelLoadError: null,
    isTestingConnection: false,
    connectionTestResult: null,
    validationError: null,
    apiKeyCleanedNotification: false,
  }
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, screen: action.screen }

    case 'GO_BACK': {
      const { screen, selectedProvider } = state
      let newScreen: WizardScreen = 'provider'

      if (screen === 'partnerProviders' || screen === 'partnerCodingPlans') {
        newScreen = 'provider'
      } else if (screen === 'baseUrl') {
        newScreen = 'provider'
      } else if (screen === 'apiKey') {
        if (selectedProvider === 'custom-openai' || selectedProvider === 'ollama') {
          newScreen = 'baseUrl'
        } else {
          newScreen = 'provider'
        }
      } else if (screen === 'resourceName') {
        newScreen = 'apiKey'
      } else if (screen === 'model') {
        newScreen = 'apiKey'
      } else if (screen === 'modelInput') {
        if (selectedProvider === 'azure') {
          newScreen = 'resourceName'
        } else {
          newScreen = 'apiKey'
        }
      } else if (screen === 'modelParams') {
        newScreen = 'model'
      } else if (screen === 'contextLength') {
        newScreen = 'modelParams'
      } else if (screen === 'connectionTest') {
        newScreen = 'contextLength'
      } else if (screen === 'confirmation') {
        newScreen = 'connectionTest'
      }

      return { ...state, screen: newScreen }
    }

    case 'SET_PROVIDER':
      return { ...state, selectedProvider: action.provider }

    case 'SET_CUSTOM_BASE_URL':
      return { ...state, customBaseUrl: action.url }

    case 'SET_PROVIDER_BASE_URL':
      return { ...state, providerBaseUrl: action.url }

    case 'SET_API_KEY':
      return { ...state, apiKey: action.key, apiKeyCleanedNotification: false }

    case 'SET_RESOURCE_NAME':
      return { ...state, resourceName: action.name }

    case 'SET_MODEL':
      return { ...state, selectedModel: action.model }

    case 'SET_CUSTOM_MODEL':
      return { ...state, customModelName: action.model, selectedModel: action.model }

    case 'SET_MAX_TOKENS':
      return { ...state, maxTokens: action.tokens, selectedMaxTokensPreset: action.preset }

    case 'SET_CONTEXT_LENGTH':
      return { ...state, contextLength: action.length }

    case 'SET_REASONING_EFFORT':
      return { ...state, reasoningEffort: action.effort }

    case 'SET_SUPPORTS_REASONING_EFFORT':
      return { ...state, supportsReasoningEffort: action.supports }

    case 'SET_LOADING_MODELS':
      return { ...state, isLoadingModels: action.loading }

    case 'SET_MODEL_LOAD_ERROR':
      return { ...state, modelLoadError: action.error }

    case 'SET_TESTING_CONNECTION':
      return { ...state, isTestingConnection: action.testing }

    case 'SET_CONNECTION_TEST_RESULT':
      return { ...state, connectionTestResult: action.result }

    case 'SET_VALIDATION_ERROR':
      return { ...state, validationError: action.error }

    case 'SET_API_KEY_CLEANED_NOTIFICATION':
      return { ...state, apiKeyCleanedNotification: action.show }

    case 'SET_PARTNER_PROVIDER_FOCUS':
      return { ...state, partnerProviderFocusIndex: action.index }

    case 'SET_CODING_PLAN_FOCUS':
      return { ...state, codingPlanFocusIndex: action.index }

    case 'SET_ACTIVE_FIELD':
      return { ...state, activeFieldIndex: action.index }

    default:
      return state
  }
}

export function useModelSetupWizard(initialConfig: any) {
  const [state, dispatch] = useReducer(wizardReducer, getInitialState(initialConfig))

  const setScreen = useCallback((screen: WizardScreen) => {
    dispatch({ type: 'SET_SCREEN', screen })
  }, [])

  const goBack = useCallback(() => {
    dispatch({ type: 'GO_BACK' })
  }, [])

  const setProvider = useCallback((provider: ProviderKey) => {
    dispatch({ type: 'SET_PROVIDER', provider })
  }, [])

  const setCustomBaseUrl = useCallback((url: string) => {
    dispatch({ type: 'SET_CUSTOM_BASE_URL', url })
  }, [])

  const setProviderBaseUrl = useCallback((url: string) => {
    dispatch({ type: 'SET_PROVIDER_BASE_URL', url })
  }, [])

  const setApiKey = useCallback((key: string) => {
    dispatch({ type: 'SET_API_KEY', key })
  }, [])

  const setResourceName = useCallback((name: string) => {
    dispatch({ type: 'SET_RESOURCE_NAME', name })
  }, [])

  const setModel = useCallback((model: string) => {
    dispatch({ type: 'SET_MODEL', model })
  }, [])

  const setCustomModel = useCallback((model: string) => {
    dispatch({ type: 'SET_CUSTOM_MODEL', model })
  }, [])

  const setMaxTokens = useCallback((tokens: string, preset: number) => {
    dispatch({ type: 'SET_MAX_TOKENS', tokens, preset })
  }, [])

  const setContextLength = useCallback((length: number) => {
    dispatch({ type: 'SET_CONTEXT_LENGTH', length })
  }, [])

  const setReasoningEffort = useCallback((effort: 'low' | 'medium' | 'high' | null) => {
    dispatch({ type: 'SET_REASONING_EFFORT', effort })
  }, [])

  const setSupportsReasoningEffort = useCallback((supports: boolean) => {
    dispatch({ type: 'SET_SUPPORTS_REASONING_EFFORT', supports })
  }, [])

  const setLoadingModels = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING_MODELS', loading })
  }, [])

  const setModelLoadError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_MODEL_LOAD_ERROR', error })
  }, [])

  const setTestingConnection = useCallback((testing: boolean) => {
    dispatch({ type: 'SET_TESTING_CONNECTION', testing })
  }, [])

  const setConnectionTestResult = useCallback((result: WizardState['connectionTestResult']) => {
    dispatch({ type: 'SET_CONNECTION_TEST_RESULT', result })
  }, [])

  const setValidationError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_VALIDATION_ERROR', error })
  }, [])

  const setApiKeyCleanedNotification = useCallback((show: boolean) => {
    dispatch({ type: 'SET_API_KEY_CLEANED_NOTIFICATION', show })
  }, [])

  const setPartnerProviderFocus = useCallback((index: number) => {
    dispatch({ type: 'SET_PARTNER_PROVIDER_FOCUS', index })
  }, [])

  const setCodingPlanFocus = useCallback((index: number) => {
    dispatch({ type: 'SET_CODING_PLAN_FOCUS', index })
  }, [])

  const setActiveField = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_FIELD', index })
  }, [])

  return {
    state,
    actions: {
      setScreen,
      goBack,
      setProvider,
      setCustomBaseUrl,
      setProviderBaseUrl,
      setApiKey,
      setResourceName,
      setModel,
      setCustomModel,
      setMaxTokens,
      setContextLength,
      setReasoningEffort,
      setSupportsReasoningEffort,
      setLoadingModels,
      setModelLoadError,
      setTestingConnection,
      setConnectionTestResult,
      setValidationError,
      setApiKeyCleanedNotification,
      setPartnerProviderFocus,
      setCodingPlanFocus,
      setActiveField,
    },
  }
}
