import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, Newline } from 'ink'
import { getTheme } from '../../utils/theme'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config'
import { Select } from '../ui/Select'
import TextInput from '../ui/TextInput'
import {
  fetchAnthropicModels,
  fetchOpenAIModels,
  fetchCustomModels,
  type ModelInfo,
} from '../../services/models'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { providers, type ProviderKey } from '../../constants/providers'
import models from '../../constants/models'
import { verifyApiKey } from '../../services/apiVerification'

type ModelSelectorProps = {
  onDone: () => void
  isOnboarding?: boolean
}

// Constants for model parameters
type ContextLengthOption = {
  label: string
  value: number
}

const CONTEXT_LENGTH_OPTIONS: ContextLengthOption[] = [
  { label: '32K tokens', value: 32000 },
  { label: '64K tokens', value: 64000 },
  { label: '128K tokens (recommended)', value: 128000 },
  { label: '200K tokens', value: 200000 },
  { label: '256K tokens', value: 256000 },
  { label: '300K tokens', value: 300000 },
  { label: '512K tokens', value: 512000 },
  { label: '1000K tokens', value: 1000000 },
  { label: '2000K tokens', value: 2000000 },
  { label: '3000K tokens', value: 3000000 },
  { label: '5000K tokens', value: 5000000 },
  { label: '10000K tokens', value: 10000000 },
]

const DEFAULT_CONTEXT_LENGTH = 128000

type MaxTokensOption = {
  label: string
  value: number
}

const MAX_TOKENS_OPTIONS: MaxTokensOption[] = [
  { label: '1K tokens', value: 1024 },
  { label: '2K tokens', value: 2048 },
  { label: '4K tokens', value: 4096 },
  { label: '8K tokens (recommended)', value: 8192 },
  { label: '16K tokens', value: 16384 },
  { label: '32K tokens', value: 32768 },
  { label: '64K tokens', value: 65536 },
  { label: '128K tokens', value: 131072 },
]

const DEFAULT_MAX_TOKENS = 8192

type ReasoningEffortOption = 'low' | 'medium' | 'high'

const REASONING_EFFORT_OPTIONS: { label: string; value: ReasoningEffortOption }[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
]

  // Helper function to get provider label (similar to Kode-cli)
  function getProviderLabel(provider: ProviderKey, modelCount: number): string {
    // Use provider names from the providers object if available
    if (providers[provider]) {
      return `${providers[provider].name} (${modelCount} models)`
    }
    return `${provider}`
  }

export function ModelSelector({ onDone, isOnboarding = false }: ModelSelectorProps) {
  const theme = getTheme()
  const config = getGlobalConfig()
  const [screen, setScreen] = useState<
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
  >('provider')
  
  // State for submenu navigation
  const [partnerProviderFocusIndex, setPartnerProviderFocusIndex] = useState(0)
  const [codingPlanFocusIndex, setCodingPlanFocusIndex] = useState(0)
  
  // Define main menu structure (similar to Kode-cli)
  const mainMenuOptions = [
    { value: 'custom-openai', label: 'Custom OpenAI-Compatible API' },
    { value: 'custom-anthropic', label: 'Custom Anthropic-Compatible API' },
    { value: 'partnerProviders', label: 'Partner Providers →' },
    { value: 'partnerCodingPlans', label: 'Partner Coding Plans →' },
    { value: 'ollama', label: getProviderLabel('ollama', models.ollama?.length || 0) },
  ]

  // Define partner providers with custom ranking
  const rankedProviders = [
    'openai',      // OpenAI first
    'anthropic',   // Claude after OpenAI
    'gemini',      // Gemini after Claude
    'glm',         // GLM
    'kimi',        // Kimi
    'minimax',     // MiniMax
    'qwen',        // Qwen (Alibaba)
    'deepseek',    // DeepSeek
    'openrouter',  // OpenRouter
    'burncloud',   // BurnCloud after OpenRouter
    'siliconflow', // SiliconFlow
    // Other providers follow
    'baidu-qianfan',
    'mistral',
    'xai',
    'groq',
    'azure',
  ]

  // Filter to only include providers that exist and aren't coding/custom
  const partnerProviders = rankedProviders.filter(provider =>
    providers[provider as ProviderKey] &&
    !provider.includes('coding') &&
    provider !== 'custom-openai' &&
    provider !== 'ollama' &&
    models[provider as keyof typeof models] !== undefined
  )

  // Define partner coding plans
  const codingPlanProviders = (Object.keys(providers) as ProviderKey[]).filter(
    provider => provider.includes('coding')
  )

  // Create provider options for partner providers submenu
  const partnerProviderOptions = partnerProviders.map(provider => {
    const modelCount = models[provider as keyof typeof models]?.length || 0
    const label = getProviderLabel(provider as ProviderKey, modelCount)
    return {
      label,
      value: provider,
    }
  })

  // Create provider options for coding plans submenu
  const codingPlanOptions = codingPlanProviders.map(provider => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return {
      label,
      value: provider,
    }
  })
  
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>(
    (config.model?.provider as ProviderKey) || 'anthropic',
  )
  const [providerBaseUrl, setProviderBaseUrl] = useState<string>(
    config.model?.baseURL || providers[selectedProvider]?.baseURL || '',
  )
  // Separate state for custom-openai base URL
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>(config.model?.apiKey || '')
  const [selectedModel, setSelectedModel] = useState<string>(config.model?.name || '')
  // Azure resource name state
  const [resourceName, setResourceName] = useState<string>('')
  // Ollama base URL state
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://localhost:11434/v1')
  
  // Model fetching state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const [customModelName, setCustomModelName] = useState<string>('')
  
  // Model parameters state
  const [maxTokens, setMaxTokens] = useState<string>(
    config.model?.maxTokens?.toString() || DEFAULT_MAX_TOKENS.toString(),
  )
  const [selectedMaxTokensPreset, setSelectedMaxTokensPreset] = useState<number>(
    config.model?.maxTokens || DEFAULT_MAX_TOKENS,
  )
  const [contextLength, setContextLength] = useState<number>(
    config.model?.contextLength || DEFAULT_CONTEXT_LENGTH,
  )
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortOption | null>(
    (config.model?.reasoningEffort as ReasoningEffortOption) || null,
  )
  const [supportsReasoningEffort, setSupportsReasoningEffort] = useState<boolean>(false)
  
  // Form focus state for modelParams
  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  
  // Connection test state
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean
    message: string
    endpoint?: string
    details?: string
  } | null>(null)
  
  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null)
  // State for API key cleaning notification
  const [apiKeyCleanedNotification, setApiKeyCleanedNotification] = useState(false)

  // Handle Escape key to go back
  useInput(
    (input, key) => {
      if (key.escape) {
        if (screen === 'partnerProviders' || screen === 'partnerCodingPlans') {
          // Go back to the provider (main menu) screen
          setScreen('provider')
          return
        }
        
        if (screen === 'baseUrl') {
          setScreen('provider')
        } else if (screen === 'apiKey') {
          // If we came from baseUrl (custom-openai or ollama), go back there
          // Otherwise go to provider
          if (selectedProvider === 'custom-openai' || selectedProvider === 'ollama') {
            setScreen('baseUrl')
          } else {
            setScreen('provider')
          }
        } else if (screen === 'resourceName') {
          setScreen('apiKey')
        } else if (screen === 'model') {
          setScreen('apiKey')
        } else if (screen === 'modelInput') {
          // If we came from resourceName (Azure), go back there
          // Otherwise go to apiKey
          if (selectedProvider === 'azure') {
            setScreen('resourceName')
          } else {
            setScreen('apiKey')
          }
        } else if (screen === 'modelParams') {
          setScreen('model')
        } else if (screen === 'contextLength') {
          setScreen('modelParams')
        } else if (screen === 'connectionTest') {
          setScreen('contextLength')
        } else if (screen === 'confirmation') {
          setScreen('connectionTest')
        } else {
          onDone()
        }
      }
    },
    { isActive: true },
  )
  
  // Handle arrow keys for submenu navigation
  useInput(
    (input, key) => {
      // Partner providers submenu navigation
      if (screen === 'partnerProviders') {
        if (key.upArrow) {
          setPartnerProviderFocusIndex(prev =>
            partnerProviderOptions.length === 0
              ? 0
              : (prev - 1 + partnerProviderOptions.length) %
                partnerProviderOptions.length,
          )
          return
        }
        if (key.downArrow) {
          setPartnerProviderFocusIndex(prev =>
            partnerProviderOptions.length === 0
              ? 0
              : (prev + 1) % partnerProviderOptions.length,
          )
          return
        }
        if (key.return) {
          const opt = partnerProviderOptions[partnerProviderFocusIndex]
          if (opt) {
            handleProviderSelection(opt.value)
          }
          return
        }
      }
      
      // Partner coding plans submenu navigation
      if (screen === 'partnerCodingPlans') {
        if (key.upArrow) {
          setCodingPlanFocusIndex(prev =>
            codingPlanOptions.length === 0
              ? 0
              : (prev - 1 + codingPlanOptions.length) %
                codingPlanOptions.length,
          )
          return
        }
        if (key.downArrow) {
          setCodingPlanFocusIndex(prev =>
            codingPlanOptions.length === 0
              ? 0
              : (prev + 1) % codingPlanOptions.length,
          )
          return
        }
        if (key.return) {
          const opt = codingPlanOptions[codingPlanFocusIndex]
          if (opt) {
            handleProviderSelection(opt.value)
          }
          return
        }
      }
    },
    { isActive: screen === 'partnerProviders' || screen === 'partnerCodingPlans' },
  )

  // Handle Enter key for contextLength, connectionTest, and confirmation
  useInput(
    (input, key) => {
      if (key.return) {
        if (screen === 'modelParams') {
          handleModelParamsSubmit()
        } else if (screen === 'contextLength') {
          handleContextLengthSubmit()
        } else if (screen === 'connectionTest' && !isTestingConnection && !connectionTestResult) {
          handleConnectionTest()
        } else if (screen === 'connectionTest' && connectionTestResult && !connectionTestResult.success) {
          // Retry connection test
          handleConnectionTest()
        } else if (screen === 'confirmation') {
          handleConfirmation()
        }
      }
    },
    { isActive: true },
  )

  // Handle arrow keys for contextLength
  useInput(
    (input, key) => {
      if (screen === 'contextLength') {
        if (key.upArrow) {
          const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
            (opt) => opt.value === contextLength,
          )
          const prevIndex =
            (currentIndex - 1 + CONTEXT_LENGTH_OPTIONS.length) %
            CONTEXT_LENGTH_OPTIONS.length
          setContextLength(CONTEXT_LENGTH_OPTIONS[prevIndex].value)
        } else if (key.downArrow) {
          const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
            (opt) => opt.value === contextLength,
          )
          const nextIndex = (currentIndex + 1) % CONTEXT_LENGTH_OPTIONS.length
          setContextLength(CONTEXT_LENGTH_OPTIONS[nextIndex].value)
        }
      }
    },
    { isActive: screen === 'contextLength' },
  )

  // Handle Tab key for modelParams navigation
  useInput(
    (input, key) => {
      if (screen === 'modelParams' && key.tab) {
        const formFields = getFormFieldsForModelParams()
        setActiveFieldIndex((prev) => (prev + 1) % formFields.length)
      }
    },
    { isActive: screen === 'modelParams' },
  )

  const handleProviderSelection = (provider: string) => {
    // Handle main menu navigation
    if (provider === 'partnerProviders') {
      setPartnerProviderFocusIndex(0)
      setScreen('partnerProviders')
      return
    } else if (provider === 'partnerCodingPlans') {
      setCodingPlanFocusIndex(0)
      setScreen('partnerCodingPlans')
      return
    } else if (provider === 'custom-anthropic') {
      // For custom Anthropic API, go to base URL screen
      setSelectedProvider('anthropic' as ProviderKey)
      setProviderBaseUrl('')
      setScreen('baseUrl')
      return
    }

    // Handle actual provider selection
    const providerType = provider as ProviderKey
    setSelectedProvider(providerType)

    if (providerType === 'custom-openai') {
      // For custom-openai, use separate customBaseUrl state
      setCustomBaseUrl('')
      setScreen('baseUrl')
    } else if (providerType === 'ollama') {
      // For ollama, need to configure base URL
      const defaultBaseUrl = providers[providerType]?.baseURL || 'http://localhost:11434/v1'
      setProviderBaseUrl(defaultBaseUrl)
      setOllamaBaseUrl(defaultBaseUrl)
      setScreen('baseUrl')
    } else {
      // For all standard partner providers, skip baseUrl and go directly to API key
      const defaultBaseUrl = providers[providerType]?.baseURL || ''
      setProviderBaseUrl(defaultBaseUrl)
      setScreen('apiKey')
    }
  }

  const handleCustomBaseUrlSubmit = (url: string) => {
    // Automatically remove trailing slash from baseURL
    const cleanUrl = url.replace(/\/+$/, '')
    setCustomBaseUrl(cleanUrl)
    // After setting custom base URL, go to API key input
    setScreen('apiKey')
  }

  const handleBaseUrlSubmit = (url: string) => {
    // Automatically remove trailing slash from baseURL
    const cleanUrl = url.replace(/\/+$/, '')
    setProviderBaseUrl(cleanUrl || providers[selectedProvider]?.baseURL || '')

    // For Ollama, handle differently - it tries to fetch models immediately
    if (selectedProvider === 'ollama') {
      setOllamaBaseUrl(cleanUrl || 'http://localhost:11434/v1')
      setIsLoadingModels(true)
      setModelLoadError(null)

      // Use the dedicated Ollama model fetch function
      fetchOllamaModels().finally(() => {
        setIsLoadingModels(false)
      })
    } else {
      // For all other providers, go to API key input next
      setScreen('apiKey')
    }
  }

  // Fetch Ollama models
  const fetchOllamaModels = useCallback(async () => {
    setIsLoadingModels(true)
    setModelLoadError(null)

    try {
      const baseURL = ollamaBaseUrl || 'http://localhost:11434/v1'
      const response = await fetch(`${baseURL.replace(/\/v1$/, '')}/api/tags`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(
          `Failed to connect to Ollama server: ${response.status} ${response.statusText}`,
        )
      }

      const data = await response.json()
      const ollamaModels = (data.models || []).map((model: any) => ({
        model: model.name || model.model || 'unknown',
        provider: 'ollama',
        max_tokens: 8192,
        supports_vision: false,
        supports_function_calling: false,
        supports_reasoning_effort: false,
      }))

      setAvailableModels(ollamaModels)

      // Only navigate if we have models
      if (ollamaModels.length > 0) {
        setScreen('model')
      } else {
        setModelLoadError('No models found in your Ollama installation')
      }

      return ollamaModels
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('fetch')) {
        setModelLoadError(
          `Could not connect to Ollama server at ${ollamaBaseUrl}. Make sure Ollama is running and the URL is correct.`,
        )
      } else {
        setModelLoadError(`Error loading Ollama models: ${errorMessage}`)
      }

      console.error('Error fetching Ollama models:', error)
      throw error
    } finally {
      setIsLoadingModels(false)
    }
  }, [ollamaBaseUrl])

  const fetchModelsWithRetry = useCallback(async (): Promise<ModelInfo[]> => {
    setIsLoadingModels(true)
    setModelLoadError(null)

    try {
      let models: ModelInfo[] = []

      // For custom-openai, use fetchCustomModels
      if (selectedProvider === 'custom-openai') {
        const customModels = await fetchCustomModels(customBaseUrl, apiKey)
        models = customModels.map((model: any) => ({
          model: model.modelName || model.id || model.name || model.model || 'unknown',
          provider: 'custom-openai',
          max_tokens: model.max_tokens || 4096,
          supports_vision: false,
          supports_function_calling: true,
          supports_reasoning_effort: false,
        }))
        setAvailableModels(models)
        if (models.length > 0) {
          setScreen('model')
        } else {
          setScreen('modelInput')
        }
        return models
      }

      // For Anthropic provider
      if (selectedProvider === 'anthropic') {
        models = await fetchAnthropicModels(apiKey)
      } 
      // For OpenAI provider
      else if (selectedProvider === 'openai') {
        models = await fetchOpenAIModels(apiKey)
      }
      // For other OpenAI-compatible providers, use fetchCustomModels
      else {
        const baseURL = providerBaseUrl || providers[selectedProvider]?.baseURL || ''
        const customModels = await fetchCustomModels(baseURL, apiKey)
        models = customModels.map((model: any) => ({
          model: model.modelName || model.id || model.name || model.model || 'unknown',
          provider: selectedProvider,
          max_tokens: model.max_tokens || 8192,
          supports_vision: false,
          supports_function_calling: true,
          supports_reasoning_effort: false,
        }))
      }

      setAvailableModels(models)
      if (models.length > 0) {
        setScreen('model')
      } else {
        // No models but API key is valid - allow proceeding to manual model input
        setScreen('modelInput')
      }
      return models
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setModelLoadError(errorMessage)
      // Don't auto-navigate on API key failure - show error and stay on API key screen
      throw error
    } finally {
      setIsLoadingModels(false)
    }
  }, [selectedProvider, apiKey, customBaseUrl, providerBaseUrl])

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setApiKeyCleanedNotification(false)
  }

  const handleApiKeySubmit = async (key: string) => {
    // Clean the API key before saving
    const cleanedKey = key.replace(/[\r\n]/g, '').trim()
    
    // Show notification if key was cleaned
    if (cleanedKey !== key) {
      setApiKeyCleanedNotification(true)
    }
    
    setApiKey(cleanedKey)

    // Clear previous error
    setModelLoadError(null)

    // For Azure, go to resource name input next
    if (selectedProvider === 'azure') {
      setScreen('resourceName')
      return
    }

    // For Ollama, API key is optional
    if (selectedProvider === 'ollama') {
      setScreen('modelInput')
      return
    }
    
    if (!cleanedKey.trim()) {
      return // Don't submit empty API key for other providers
    }
    
    // Verify API key by fetching models
    try {
      setIsLoadingModels(true)
      const models = await fetchModelsWithRetry()

      // Only proceed if we successfully fetched models
      if (models && models.length > 0) {
        // Models loaded successfully, navigation will be handled by fetchModelsWithRetry
      } else if (models && models.length === 0) {
        // No models but API key is valid - allow proceeding to manual model input
        setScreen('modelInput')
      }
    } catch (error) {
      // API key validation failed - stay on this screen
      console.error('API key validation failed:', error)
      // Error is already displayed by fetchModelsWithRetry
      // Don't navigate - user needs to fix API key
    } finally {
      setIsLoadingModels(false)
    }
  }

  const handleModelSelection = (model: string) => {
    setSelectedModel(model)
    
    // Check if the selected model supports reasoning_effort
    const modelInfo = availableModels.find((m) => m.model === model)
    setSupportsReasoningEffort(modelInfo?.supports_reasoning_effort || false)

    if (!modelInfo?.supports_reasoning_effort) {
      setReasoningEffort(null)
    }

    // Set max tokens based on model info or default
    if (modelInfo?.max_tokens) {
      const modelMaxTokens = modelInfo.max_tokens
      // Check if the model's max tokens matches any of our presets
      const matchingPreset = MAX_TOKENS_OPTIONS.find(
        (option) => option.value === modelMaxTokens,
      )

      if (matchingPreset) {
        setSelectedMaxTokensPreset(modelMaxTokens)
        setMaxTokens(modelMaxTokens.toString())
      } else {
        setMaxTokens(modelMaxTokens.toString())
      }
    } else {
      // No model-specific max tokens, use default
      setSelectedMaxTokensPreset(DEFAULT_MAX_TOKENS)
      setMaxTokens(DEFAULT_MAX_TOKENS.toString())
    }

    // Go to model parameters screen
    setScreen('modelParams')
    setActiveFieldIndex(0)
  }

  const handleCustomModelSubmit = (model: string) => {
    if (!model.trim()) {
      return // Don't submit empty model name
    }
    setCustomModelName(model)
    setSelectedModel(model)
    // Use default values for manually entered models
    setSupportsReasoningEffort(false)
    setReasoningEffort(null)
    setSelectedMaxTokensPreset(DEFAULT_MAX_TOKENS)
    setMaxTokens(DEFAULT_MAX_TOKENS.toString())
    // Go to model parameters screen
    setScreen('modelParams')
    setActiveFieldIndex(0)
  }

  const handleResourceNameSubmit = (name: string) => {
    if (!name.trim()) {
      return // Don't submit empty resource name
    }
    setResourceName(name)
    // After setting resource name, go to model input
    setScreen('modelInput')
  }

  const handleModelParamsSubmit = () => {
    // Ensure contextLength is set to a valid option before navigating
    if (!CONTEXT_LENGTH_OPTIONS.find((opt) => opt.value === contextLength)) {
      setContextLength(DEFAULT_CONTEXT_LENGTH)
    }
    // Navigate to context length screen
    setScreen('contextLength')
  }

  const handleContextLengthSubmit = () => {
    // Navigate to connection test screen
    setScreen('connectionTest')
  }

  async function testConnection(): Promise<{
    success: boolean
    message: string
    endpoint?: string
    details?: string
  }> {
    setIsTestingConnection(true)
    setConnectionTestResult(null)

    try {
      // Use customBaseUrl for custom-openai, otherwise use providerBaseUrl
      let testBaseURL = ''
      if (selectedProvider === 'custom-openai') {
        testBaseURL = customBaseUrl
      } else {
        testBaseURL = providerBaseUrl || providers[selectedProvider]?.baseURL || ''
      }

      if (selectedProvider === 'anthropic') {
        // Test Anthropic API
        try {
          const anthropic = new Anthropic({
            apiKey: apiKey,
            baseURL: testBaseURL,
          })

          await anthropic.messages.create({
            model: selectedModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          return {
            success: true,
            message: '✅ Connection test successful',
            endpoint: `${testBaseURL}/v1/messages`,
          }
        } catch (error) {
          return {
            success: false,
            message: '❌ Connection test failed',
            endpoint: `${testBaseURL}/v1/messages`,
            details:
              error instanceof Error ? error.message : 'Unknown error',
          }
        }
      } else if (selectedProvider === 'openai' || selectedProvider === 'custom-openai' || 
                 selectedProvider === 'kimi' || selectedProvider === 'deepseek' ||
                 selectedProvider === 'qwen' || selectedProvider === 'glm' ||
                 selectedProvider === 'minimax' || selectedProvider === 'baidu-qianfan' ||
                 selectedProvider === 'siliconflow' || selectedProvider === 'openrouter' ||
                 selectedProvider === 'burncloud' || selectedProvider === 'mistral' ||
                 selectedProvider === 'xai' || selectedProvider === 'groq') {
        // Test OpenAI-compatible API
        try {
          const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: testBaseURL,
          })

          await openai.chat.completions.create({
            model: selectedModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          return {
            success: true,
            message: '✅ Connection test successful',
            endpoint: `${testBaseURL}/chat/completions`,
          }
        } catch (error) {
          return {
            success: false,
            message: '❌ Connection test failed',
            endpoint: `${testBaseURL}/chat/completions`,
            details:
              error instanceof Error ? error.message : 'Unknown error',
          }
        }
      } else if (selectedProvider === 'ollama') {
        // For Ollama, skip connection test (local server)
        return {
          success: true,
          message: '✅ Configuration ready (connection test skipped for Ollama)',
        }
      } else {
        // For other custom providers, skip connection test
        return {
          success: true,
          message: '✅ Configuration ready (connection test skipped for custom provider)',
        }
      }
    } catch (error) {
      return {
        success: false,
        message: 'Connection test failed',
        details: error instanceof Error ? error.message : String(error),
      }
    } finally {
      setIsTestingConnection(false)
    }
  }

  async function handleConnectionTest() {
    const result = await testConnection()
    setConnectionTestResult(result)

    if (result.success) {
      // Auto-advance to confirmation after a short delay
      setTimeout(() => {
        setScreen('confirmation')
      }, 2000)
    }
  }

  function handleConfirmation() {
    // Save configuration
    // Use customBaseUrl for custom-openai, otherwise use providerBaseUrl
    const baseURL = selectedProvider === 'custom-openai' ? customBaseUrl : providerBaseUrl
    
    const updatedConfig = {
      ...getGlobalConfig(),
      model: {
        provider: selectedProvider,
        baseURL: baseURL,
        apiKey: apiKey,
        name: selectedModel,
        maxTokens: parseInt(maxTokens) || DEFAULT_MAX_TOKENS,
        contextLength: contextLength || DEFAULT_CONTEXT_LENGTH,
        reasoningEffort: reasoningEffort || undefined,
      },
    }
    saveGlobalConfig(updatedConfig)
    // Instead of calling onDone, we'll render ChatScreen
    // This will be handled by the parent component
    onDone()
  }

  // Helper function to get form fields for model params
  function getFormFieldsForModelParams() {
    return [
      {
        name: 'maxTokens',
        label: 'Maximum Tokens',
        description: 'Select the maximum number of tokens to generate.',
        value: parseInt(maxTokens),
        component: 'select',
        options: MAX_TOKENS_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value.toString(),
        })),
        defaultValue: maxTokens,
      },
      ...(supportsReasoningEffort
        ? [
            {
              name: 'reasoningEffort',
              label: 'Reasoning Effort',
              description: 'Controls reasoning depth for complex problems.',
              value: reasoningEffort,
              component: 'select',
            },
          ]
        : []),
      {
        name: 'submit',
        label: 'Continue →',
        component: 'button',
      },
    ]
  }

  // Use main menu options for provider selection screen
  const providerOptions = mainMenuOptions

  // Get model options for Select component
  const modelOptions = availableModels.map((model) => ({
    label: model.model,
    value: model.model,
  }))

  // Get placeholder and examples for manual model input
  const getModelInputInfo = () => {
    switch (selectedProvider) {
      case 'anthropic':
        return {
          placeholder: 'claude-3-5-sonnet-latest',
          examples: 'For example: "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"',
        }
      case 'openai':
        return {
          placeholder: 'gpt-4o',
          examples: 'For example: "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"',
        }
      default:
        return {
          placeholder: 'model-name',
          examples: 'Enter the model name as supported by your API',
        }
    }
  }

  const providerName = getProviderLabel(selectedProvider, models[selectedProvider]?.length || 0)
  const defaultBaseUrl = providers[selectedProvider]?.baseURL || ''

  if (screen === 'partnerProviders') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Partner Providers</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Select a partner AI provider for this model profile:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Choose from official partner providers to access their models and services.
            </Text>
          </Box>

          <Select
            options={partnerProviderOptions}
            onChange={handleProviderSelection}
          />

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to
              main menu
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'partnerCodingPlans') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Partner Coding Plans</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Select a partner coding plan for specialized programming assistance:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              These are specialized models optimized for coding and development tasks.
              <Newline />
              They require specific coding plan subscriptions from the respective providers.
            </Text>
          </Box>

          <Select
            options={codingPlanOptions}
            onChange={handleProviderSelection}
          />

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to
              main menu
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'provider') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Select AI Provider:</Text>
        <Text color={theme.secondaryText}>
          Choose your preferred AI provider
        </Text>
        <Select
          options={providerOptions}
          onChange={handleProviderSelection}
        />
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    )
  }

  // Helper function to format API key display
  const formatApiKeyDisplay = (key: string): string => {
    if (key.length <= 7) {
      return key
    }
    return `${key.substring(0, 3)}...${key.substring(key.length - 4)}`
  }

  // Check if current provider is custom-openai
  const isCustomOpenAI = selectedProvider === 'custom-openai'

  if (screen === 'baseUrl') {
    // For custom-openai, show special "Custom API Server Setup" screen
    if (isCustomOpenAI) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={theme.secondaryBorder}
            paddingX={2}
            paddingY={1}
          >
            <Text bold>Custom API Server Setup</Text>
            <Box flexDirection="column" gap={1}>
              <Text bold>Enter your custom API URL:</Text>
              <Box flexDirection="column" width={70}>
                <Text color={theme.secondaryText}>
                  This is the base URL for your OpenAI-compatible API.
                  <Newline />
                  For example: https://api.example.com/v1
                </Text>
              </Box>

              <Box>
                <TextInput
                  placeholder="https://api.example.com/v1"
                  value={customBaseUrl}
                  onChange={setCustomBaseUrl}
                  onSubmit={handleCustomBaseUrlSubmit}
                  focus={!isLoadingModels}
                />
              </Box>

              <Box marginTop={1}>
                <Text>
                  <Text
                    color={
                      isLoadingModels ? theme.secondaryText : theme.suggestion
                    }
                  >
                    [Submit Base URL]
                  </Text>
                  <Text> - Press Enter or click to continue</Text>
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text dimColor>
                  Press <Text color={theme.suggestion}>Enter</Text> to continue
                  or <Text color={theme.suggestion}>Esc</Text> to go back
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )
    }

    // For all other providers, use the general provider URL configuration
    const providerName = providers[selectedProvider]?.name || selectedProvider
    const defaultUrl = providers[selectedProvider]?.baseURL || ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>
            {providerName} API Configuration
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Configure the API endpoint for {providerName}:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                {selectedProvider === 'ollama' ? (
                  <>
                    This is the URL of your Ollama server.
                    <Newline />
                    Default is http://localhost:11434/v1 for local Ollama
                    installations.
                  </>
                ) : (
                  <>
                    This is the base URL for the {providerName} API.
                    <Newline />
                    You can modify this URL or press Enter to use the default.
                  </>
                )}
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder={defaultUrl}
                value={providerBaseUrl}
                onChange={setProviderBaseUrl}
                onSubmit={handleBaseUrlSubmit}
                focus={!isLoadingModels}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text
                  color={
                    isLoadingModels ? theme.secondaryText : theme.suggestion
                  }
                >
                  [Submit Base URL]
                </Text>
                <Text> - Press Enter or click to continue</Text>
              </Text>
            </Box>

            {isLoadingModels && (
              <Box marginTop={1}>
                <Text color={theme.success}>
                  {selectedProvider === 'ollama'
                    ? 'Connecting to Ollama server...'
                    : `Connecting to ${providerName}...`}
                </Text>
              </Box>
            )}

            {modelLoadError && (
              <Box marginTop={1}>
                <Text color="red">Error: {modelLoadError}</Text>
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'apiKey') {
    const modelTypeText = 'this model profile'
    const providerLabel = getProviderLabel(selectedProvider, 0).split(' (')[0]

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>API Key Setup</Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>
              Enter your {providerLabel} API key for {modelTypeText}:
            </Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                This key will be stored locally and used to access the{' '}
                {selectedProvider} API.
                <Newline />
                Your key is never sent to our servers.
                <Newline />
                <Newline />
                {selectedProvider === 'kimi' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://platform.moonshot.cn/console/api-keys
                    </Text>
                  </>
                )}
                {selectedProvider === 'deepseek' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://platform.deepseek.com/api_keys
                    </Text>
                  </>
                )}
                {selectedProvider === 'siliconflow' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://cloud.siliconflow.cn/i/oJWsm6io
                    </Text>
                  </>
                )}
                {selectedProvider === 'qwen' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://bailian.console.aliyun.com/?tab=model#/api-key
                    </Text>
                  </>
                )}
                {selectedProvider === 'glm' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://open.bigmodel.cn (API Keys section)
                    </Text>
                  </>
                )}
                {selectedProvider === 'glm-coding' && (
                  <>
                    💡 This is for GLM Coding Plan API.{' '}
                    <Text color={theme.suggestion}>
                      Use the same API key as regular GLM
                    </Text>
                    <Newline />
                    <Text dimColor>
                      Note: This uses a special endpoint for coding tasks.
                    </Text>
                  </>
                )}
                {selectedProvider === 'minimax' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://www.minimax.io/platform/user-center/basic-information
                    </Text>
                  </>
                )}
                {selectedProvider === 'minimax-coding' && (
                  <>
                    💡 Get your Coding Plan API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://platform.minimaxi.com/user-center/payment/coding-plan
                    </Text>
                    <Newline />
                    <Text dimColor>
                      Note: This requires a MiniMax Coding Plan subscription.
                    </Text>
                  </>
                )}
                {selectedProvider === 'baidu-qianfan' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://console.bce.baidu.com/iam/#/iam/accesslist
                    </Text>
                  </>
                )}
                {selectedProvider === 'anthropic' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://console.anthropic.com/settings/keys
                    </Text>
                  </>
                )}
                {selectedProvider === 'openai' && (
                  <>
                    💡 Get your API key from:{' '}
                    <Text color={theme.suggestion}>
                      https://platform.openai.com/api-keys
                    </Text>
                  </>
                )}
              </Text>
            </Box>

            <Box flexDirection="column">
              <Box>
                <TextInput
                  placeholder="Paste your API key here..."
                  value={apiKey}
                  onChange={handleApiKeyChange}
                  onSubmit={handleApiKeySubmit}
                  mask="*"
                  focus={true}
                />
              </Box>

              {apiKey && (
                <Box marginTop={1}>
                  <Text color={theme.secondaryText}>
                    Key: {formatApiKeyDisplay(apiKey)} ({apiKey.length} chars)
                  </Text>
                </Box>
              )}
            </Box>

            {apiKeyCleanedNotification && (
              <Box marginTop={1}>
                <Text color={theme.success}>
                  ✓ API key cleaned: removed line breaks and trimmed whitespace
                </Text>
              </Box>
            )}

            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!apiKey}>
                  [Submit API Key]
                </Text>
                <Text>
                  {' '}
                  - Press Enter to validate and continue
                </Text>
              </Text>
            </Box>

            {isLoadingModels && (
              <Box marginTop={1}>
                <Text color={theme.suggestion}>
                  Validating API key and fetching models...
                </Text>
                {(providerBaseUrl || customBaseUrl) && (
                  <Text dimColor>
                    Endpoint: {(customBaseUrl || providerBaseUrl)}/v1/models
                  </Text>
                )}
              </Box>
            )}

            {modelLoadError && (
              <Box marginTop={1} flexDirection="column">
                <Text color="red">❌ API Key Validation Failed</Text>
                <Text color="red">{modelLoadError}</Text>
                {(providerBaseUrl || customBaseUrl) && (
                  <Box marginTop={1}>
                    <Text dimColor>
                      Attempted endpoint: {(customBaseUrl || providerBaseUrl)}/v1/models
                    </Text>
                  </Box>
                )}
                <Box marginTop={1}>
                  <Text color={theme.warning}>
                    Please check your API key and try again.
                  </Text>
                </Box>
                {(selectedProvider === 'anthropic' ||
                  selectedProvider === 'kimi' ||
                  selectedProvider === 'deepseek' ||
                  selectedProvider === 'qwen' ||
                  selectedProvider === 'glm' ||
                  selectedProvider === 'glm-coding' ||
                  selectedProvider === 'minimax' ||
                  selectedProvider === 'minimax-coding' ||
                  selectedProvider === 'baidu-qianfan' ||
                  selectedProvider === 'siliconflow' ||
                  selectedProvider === 'custom-openai') && (
                  <Box marginTop={1}>
                    <Text color={theme.suggestion}>
                      Press <Text bold>Tab</Text> to skip to manual model input
                    </Text>
                  </Box>
                )}
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'model') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Select Model:</Text>
        <Text color={theme.secondaryText}>
          Choose a model from {selectedProvider}
        </Text>
        {modelOptions.length > 0 ? (
          <Select
            options={modelOptions}
            onChange={handleModelSelection}
          />
        ) : (
          <Text color="yellow">No models available</Text>
        )}
        <Text dimColor>
          Press Escape to go back
        </Text>
      </Box>
    )
  }

  if (screen === 'resourceName') {
    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>Azure Resource Name</Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Enter your Azure OpenAI deployment name:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                This is the deployment name for your Azure OpenAI resource.
                <Newline />
                For example: "gpt-4", "gpt-35-turbo", etc.
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="gpt-4"
                value={resourceName}
                onChange={setResourceName}
                onSubmit={handleResourceNameSubmit}
                focus={true}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text color={theme.suggestion} dimColor={!resourceName}>
                  [Submit Resource Name]
                </Text>
                <Text> - Press Enter to continue</Text>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'modelInput') {
    const { placeholder, examples } = getModelInputInfo()
    
    // Determine the screen title and description based on provider
    let screenTitle = 'Manual Model Setup'
    let description = 'Enter the model name manually'
    
    if (selectedProvider === 'azure') {
      screenTitle = 'Azure Model Setup'
      description = `Enter your Azure OpenAI deployment name${resourceName ? ` (Resource: ${resourceName})` : ''}:`
    } else if (selectedProvider === 'anthropic') {
      screenTitle = 'Claude Model Setup'
      description = `Enter the Claude model name:`
    }
    
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>{screenTitle}</Text>
        <Text color={theme.secondaryText}>
          {modelLoadError
            ? `Failed to fetch models: ${modelLoadError}. Please enter the model name manually.`
            : description}
        </Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText} dimColor>
            {examples}
          </Text>
        </Box>
        <Box>
          <Text>Model Name: </Text>
          <TextInput
            value={customModelName}
            onChange={setCustomModelName}
            onSubmit={handleCustomModelSubmit}
            placeholder={placeholder}
            focus={true}
          />
        </Box>
        <Text dimColor>
          Press Enter to confirm, Escape to go back
        </Text>
      </Box>
    )
  }

  if (screen === 'modelParams') {
    const formFields = getFormFieldsForModelParams()

    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Model Parameters</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Configure parameters for {selectedModel}:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Use <Text color={theme.suggestion}>Tab</Text> to navigate
              between fields. Press{' '}
              <Text color={theme.suggestion}>Enter</Text> to submit.
            </Text>
          </Box>

          <Box flexDirection="column">
            {formFields.map((field, index) => (
              <Box flexDirection="column" marginY={1} key={field.name}>
                {field.component !== 'button' ? (
                  <>
                    <Text
                      bold
                      color={
                        activeFieldIndex === index ? theme.success : undefined
                      }
                    >
                      {field.label}
                    </Text>
                    {field.description && (
                      <Text color={theme.secondaryText}>
                        {field.description}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text
                    bold
                    color={
                      activeFieldIndex === index ? theme.success : undefined
                    }
                  >
                    {field.label}
                  </Text>
                )}
                <Box marginY={1}>
                  {activeFieldIndex === index ? (
                    field.component === 'select' ? (
                      field.name === 'maxTokens' ? (
                        <Select
                          options={field.options || []}
                          onChange={(value) => {
                            const numValue = parseInt(value)
                            setMaxTokens(numValue.toString())
                            setSelectedMaxTokensPreset(numValue)
                            // Move to next field after selection
                            setTimeout(() => {
                              setActiveFieldIndex(index + 1)
                            }, 100)
                          }}
                          defaultValue={field.defaultValue}
                        />
                      ) : (
                        <Select
                          options={REASONING_EFFORT_OPTIONS.map((opt) => ({
                            label: opt.label,
                            value: opt.value,
                          }))}
                          onChange={(value) => {
                            setReasoningEffort(value as ReasoningEffortOption)
                            // Move to next field after selection
                            setTimeout(() => {
                              setActiveFieldIndex(index + 1)
                            }, 100)
                          }}
                          defaultValue={reasoningEffort || 'medium'}
                        />
                      )
                    ) : null
                  ) : field.name === 'maxTokens' ? (
                    <Text color={theme.secondaryText}>
                      Current:{' '}
                      <Text color={theme.suggestion}>
                        {MAX_TOKENS_OPTIONS.find(
                          (opt) => opt.value === parseInt(maxTokens),
                        )?.label || `${maxTokens} tokens`}
                      </Text>
                    </Text>
                  ) : field.name === 'reasoningEffort' ? (
                    <Text color={theme.secondaryText}>
                      Current:{' '}
                      <Text color={theme.suggestion}>
                        {reasoningEffort || 'Not set'}
                      </Text>
                    </Text>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Tab</Text> to navigate,{' '}
              <Text color={theme.suggestion}>Enter</Text> to continue, or{' '}
              <Text color={theme.suggestion}>Esc</Text> to go back
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'contextLength') {
    const selectedOption =
      CONTEXT_LENGTH_OPTIONS.find((opt) => opt.value === contextLength) ||
      CONTEXT_LENGTH_OPTIONS[2] // Default to 128K

    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Context Length Configuration</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Choose the context window length for your model:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This determines how much conversation history and context the
              model can process at once. Higher values allow for longer
              conversations but may increase costs.
            </Text>
          </Box>

          <Box flexDirection="column" marginY={1}>
            {CONTEXT_LENGTH_OPTIONS.map((option) => {
              const isSelected = option.value === contextLength
              return (
                <Box key={option.value} flexDirection="row">
                  <Text color={isSelected ? 'blue' : undefined}>
                    {isSelected ? '→ ' : '  '}
                    {option.label}
                    {option.value === DEFAULT_CONTEXT_LENGTH
                      ? ' (recommended)'
                      : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>

          <Box flexDirection="column" marginY={1}>
            <Text dimColor>
              Selected:{' '}
              <Text color={theme.suggestion}>{selectedOption.label}</Text>
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              ↑/↓ to select · Enter to continue · Esc to go back
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'connectionTest') {
    const providerDisplayName = providerName

    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Connection Test</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Testing connection to {providerDisplayName}...</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This will verify your configuration by sending a test request to
              the API.
            </Text>
          </Box>

          {!connectionTestResult && !isTestingConnection && (
            <Box marginY={1}>
              <Text>
                <Text color={theme.suggestion}>Press Enter</Text> to start the
                connection test
              </Text>
            </Box>
          )}

          {isTestingConnection && (
            <Box marginY={1}>
              <Text color={theme.suggestion}>🔄 Testing connection...</Text>
            </Box>
          )}

          {connectionTestResult && (
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text
                color={
                  connectionTestResult.success ? theme.success : 'red'
                }
              >
                {connectionTestResult.message}
              </Text>

              {connectionTestResult.endpoint && (
                <Text color={theme.secondaryText}>
                  Endpoint: {connectionTestResult.endpoint}
                </Text>
              )}

              {connectionTestResult.details && (
                <Text color={theme.secondaryText}>
                  Details: {connectionTestResult.details}
                </Text>
              )}

              {connectionTestResult.success ? (
                <Box marginTop={1}>
                  <Text color={theme.success}>
                    ✅ Automatically proceeding to confirmation...
                  </Text>
                </Box>
              ) : (
                <Box marginTop={1}>
                  <Text>
                    <Text color={theme.suggestion}>Press Enter</Text> to retry
                    test, or <Text color={theme.suggestion}>Esc</Text> to go
                    back
                  </Text>
                </Box>
              )}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to
              context length
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  if (screen === 'confirmation') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Configuration Confirmation</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm your model configuration:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Please review your selections before saving.
            </Text>
          </Box>

          {validationError && (
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text color={theme.error} bold>
                ⚠ Configuration Error:
              </Text>
              <Text color={theme.error}>{validationError}</Text>
            </Box>
          )}

          <Box flexDirection="column" marginY={1} paddingX={1}>
            <Text>
              <Text bold>Provider: </Text>
              <Text color={theme.suggestion}>{providerName}</Text>
            </Text>

            <Text>
              <Text bold>Model: </Text>
              <Text color={theme.suggestion}>{selectedModel}</Text>
            </Text>

            {apiKey && (
              <Text>
                <Text bold>API Key: </Text>
                <Text color={theme.suggestion}>****{apiKey.slice(-4)}</Text>
              </Text>
            )}

            {maxTokens && (
              <Text>
                <Text bold>Max Tokens: </Text>
                <Text color={theme.suggestion}>{maxTokens}</Text>
              </Text>
            )}

            <Text>
              <Text bold>Context Length: </Text>
              <Text color={theme.suggestion}>
                {CONTEXT_LENGTH_OPTIONS.find(
                  (opt) => opt.value === contextLength,
                )?.label || `${contextLength.toLocaleString()} tokens`}
              </Text>
            </Text>

            {supportsReasoningEffort && reasoningEffort && (
              <Text>
                <Text bold>Reasoning Effort: </Text>
                <Text color={theme.suggestion}>{reasoningEffort}</Text>
              </Text>
            )}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back or{' '}
              <Text color={theme.suggestion}>Enter</Text> to save configuration
            </Text>
          </Box>
        </Box>
      </Box>
    )
  }

  return null
}
