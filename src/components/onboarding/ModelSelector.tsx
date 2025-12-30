import React, { useCallback, useState } from 'react'
import { useInput } from 'ink'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config'
import { useModelSetupWizard } from './useModelSetupWizard'
import { ProviderSelectionStep } from './steps/ProviderSelectionStep'
import { PartnerProvidersStep } from './steps/PartnerProvidersStep'
import { PartnerCodingPlansStep } from './steps/PartnerCodingPlansStep'
import { BaseUrlStep } from './steps/BaseUrlStep'
import { ApiKeyStep } from './steps/ApiKeyStep'
import { ResourceNameStep } from './steps/ResourceNameStep'
import { ModelSelectionStep, type ModelInfo } from './steps/ModelSelectionStep'
import { ModelInputStep } from './steps/ModelInputStep'
import { ModelParamsStep } from './steps/ModelParamsStep'
import { ContextLengthStep, CONTEXT_LENGTH_OPTIONS } from './steps/ContextLengthStep'
import { ConnectionTestStep } from './steps/ConnectionTestStep'
import { ConfirmationStep } from './steps/ConfirmationStep'
import { providers, type ProviderKey } from '../../constants/providers'
import {
  fetchAnthropicModels,
  fetchOpenAIModels,
  fetchCustomModels,
} from '../../services/models'

type ModelSelectorProps = {
  onDone: () => void
  isOnboarding?: boolean
}

const DEFAULT_MAX_TOKENS = 8192

export function ModelSelector({ onDone, isOnboarding = false }: ModelSelectorProps) {
  const config = getGlobalConfig()
  const { state, actions } = useModelSetupWizard(config)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://localhost:11434/v1')

  // Handle Escape key to go back
  useInput(
    (input, key) => {
      if (key.escape) {
        actions.goBack()
      }
    },
    { isActive: true },
  )

  // Handle Enter key for specific screens
  useInput(
    (input, key) => {
      if (key.return) {
        if (state.screen === 'modelParams') {
          handleModelParamsSubmit()
        } else if (state.screen === 'contextLength') {
          handleContextLengthSubmit()
        } else if (
          state.screen === 'connectionTest' &&
          !state.isTestingConnection &&
          !state.connectionTestResult
        ) {
          handleConnectionTest()
        } else if (
          state.screen === 'connectionTest' &&
          state.connectionTestResult &&
          !state.connectionTestResult.success
        ) {
          handleConnectionTest()
        } else if (state.screen === 'confirmation') {
          handleConfirmation()
        }
      }
    },
    { isActive: true },
  )

  // Handle arrow keys for contextLength
  useInput(
    (input, key) => {
      if (state.screen === 'contextLength') {
        if (key.upArrow) {
          const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
            (opt) => opt.value === state.contextLength,
          )
          const prevIndex =
            (currentIndex - 1 + CONTEXT_LENGTH_OPTIONS.length) % CONTEXT_LENGTH_OPTIONS.length
          actions.setContextLength(CONTEXT_LENGTH_OPTIONS[prevIndex].value)
        } else if (key.downArrow) {
          const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
            (opt) => opt.value === state.contextLength,
          )
          const nextIndex = (currentIndex + 1) % CONTEXT_LENGTH_OPTIONS.length
          actions.setContextLength(CONTEXT_LENGTH_OPTIONS[nextIndex].value)
        }
      }
    },
    { isActive: state.screen === 'contextLength' },
  )

  // Handle Tab key for modelParams navigation
  useInput(
    (input, key) => {
      if (state.screen === 'modelParams' && key.tab) {
        const fieldCount = state.supportsReasoningEffort ? 3 : 2
        actions.setActiveField((state.activeFieldIndex + 1) % fieldCount)
      }
    },
    { isActive: state.screen === 'modelParams' },
  )

  const handleProviderSelection = useCallback(
    (provider: string) => {
      if (provider === 'partnerProviders') {
        actions.setScreen('partnerProviders')
        return
      } else if (provider === 'partnerCodingPlans') {
        actions.setScreen('partnerCodingPlans')
        return
      } else if (provider === 'custom-anthropic') {
        actions.setProvider('anthropic' as ProviderKey)
        actions.setProviderBaseUrl('')
        actions.setScreen('baseUrl')
        return
      }

      const providerType = provider as ProviderKey
      actions.setProvider(providerType)

      if (providerType === 'custom-openai') {
        actions.setCustomBaseUrl('')
        actions.setScreen('baseUrl')
      } else if (providerType === 'ollama') {
        const defaultBaseUrl = providers[providerType]?.baseURL || 'http://localhost:11434/v1'
        actions.setProviderBaseUrl(defaultBaseUrl)
        setOllamaBaseUrl(defaultBaseUrl)
        actions.setScreen('baseUrl')
      } else {
        const defaultBaseUrl = providers[providerType]?.baseURL || ''
        actions.setProviderBaseUrl(defaultBaseUrl)
        actions.setScreen('apiKey')
      }
    },
    [actions],
  )

  const handleCustomBaseUrlSubmit = useCallback(
    (url: string) => {
      const cleanUrl = url.replace(/\/+$/, '')
      actions.setCustomBaseUrl(cleanUrl)
      actions.setScreen('apiKey')
    },
    [actions],
  )

  const handleBaseUrlSubmit = useCallback(
    async (url: string) => {
      const cleanUrl = url.replace(/\/+$/, '')
      actions.setProviderBaseUrl(cleanUrl || providers[state.selectedProvider]?.baseURL || '')

      if (state.selectedProvider === 'ollama') {
        const baseUrl = cleanUrl || 'http://localhost:11434/v1'
        setOllamaBaseUrl(baseUrl)
        actions.setLoadingModels(true)
        actions.setModelLoadError(null)

        try {
          const response = await fetch(`${baseUrl.replace(/\/v1$/, '')}/api/tags`, {
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

          if (ollamaModels.length > 0) {
            actions.setScreen('model')
          } else {
            actions.setModelLoadError('No models found in your Ollama installation')
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (errorMessage.includes('fetch')) {
            actions.setModelLoadError(
              `Could not connect to Ollama server at ${baseUrl}. Make sure Ollama is running and the URL is correct.`,
            )
          } else {
            actions.setModelLoadError(`Error loading Ollama models: ${errorMessage}`)
          }
        } finally {
          actions.setLoadingModels(false)
        }
      } else {
        actions.setScreen('apiKey')
      }
    },
    [actions, state.selectedProvider],
  )

  const handleApiKeySubmit = useCallback(
    async (key: string) => {
      const cleanedKey = key.replace(/[\r\n]/g, '').trim()

      if (cleanedKey !== key) {
        actions.setApiKeyCleanedNotification(true)
      }

      actions.setApiKey(cleanedKey)
      actions.setModelLoadError(null)

      if (state.selectedProvider === 'azure') {
        actions.setScreen('resourceName')
        return
      }

      if (state.selectedProvider === 'ollama') {
        actions.setScreen('modelInput')
        return
      }

      if (!cleanedKey.trim()) {
        return
      }

      try {
        actions.setLoadingModels(true)
        let models: ModelInfo[] = []

        if (state.selectedProvider === 'custom-openai') {
          const customModels = await fetchCustomModels(state.customBaseUrl, cleanedKey)
          models = customModels.map((model: any) => ({
            model: model.modelName || model.id || model.name || model.model || 'unknown',
            provider: 'custom-openai',
            max_tokens: model.max_tokens || 4096,
            supports_vision: false,
            supports_function_calling: true,
            supports_reasoning_effort: false,
          }))
        } else if (state.selectedProvider === 'anthropic') {
          models = await fetchAnthropicModels(cleanedKey)
        } else if (state.selectedProvider === 'openai') {
          models = await fetchOpenAIModels(cleanedKey)
        } else {
          const baseURL = state.providerBaseUrl || providers[state.selectedProvider]?.baseURL || ''
          const customModels = await fetchCustomModels(baseURL, cleanedKey)
          models = customModels.map((model: any) => ({
            model: model.modelName || model.id || model.name || model.model || 'unknown',
            provider: state.selectedProvider,
            max_tokens: model.max_tokens || 8192,
            supports_vision: false,
            supports_function_calling: true,
            supports_reasoning_effort: false,
          }))
        }

        setAvailableModels(models)

        if (models.length > 0) {
          actions.setScreen('model')
        } else {
          actions.setScreen('modelInput')
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        actions.setModelLoadError(errorMessage)
      } finally {
        actions.setLoadingModels(false)
      }
    },
    [actions, state.selectedProvider, state.customBaseUrl, state.providerBaseUrl],
  )

  const handleResourceNameSubmit = useCallback(
    (name: string) => {
      if (!name.trim()) return
      actions.setResourceName(name)
      actions.setScreen('modelInput')
    },
    [actions],
  )

  const handleModelSelection = useCallback(
    (model: string) => {
      actions.setModel(model)

      const modelInfo = availableModels.find((m) => m.model === model)
      actions.setSupportsReasoningEffort(modelInfo?.supports_reasoning_effort || false)

      if (!modelInfo?.supports_reasoning_effort) {
        actions.setReasoningEffort(null)
      }

      if (modelInfo?.max_tokens) {
        actions.setMaxTokens(modelInfo.max_tokens.toString(), modelInfo.max_tokens)
      } else {
        actions.setMaxTokens(DEFAULT_MAX_TOKENS.toString(), DEFAULT_MAX_TOKENS)
      }

      actions.setScreen('modelParams')
      actions.setActiveField(0)
    },
    [actions, availableModels],
  )

  const handleCustomModelSubmit = useCallback(
    (model: string) => {
      if (!model.trim()) return
      actions.setCustomModel(model)
      actions.setSupportsReasoningEffort(false)
      actions.setReasoningEffort(null)
      actions.setMaxTokens(DEFAULT_MAX_TOKENS.toString(), DEFAULT_MAX_TOKENS)
      actions.setScreen('modelParams')
      actions.setActiveField(0)
    },
    [actions],
  )

  const handleModelParamsSubmit = useCallback(() => {
    actions.setScreen('contextLength')
  }, [actions])

  const handleContextLengthSubmit = useCallback(() => {
    actions.setScreen('connectionTest')
  }, [actions])

  const handleConnectionTest = useCallback(async () => {
    actions.setTestingConnection(true)
    actions.setConnectionTestResult(null)

    try {
      let testBaseURL = ''
      if (state.selectedProvider === 'custom-openai') {
        testBaseURL = state.customBaseUrl
      } else {
        testBaseURL = state.providerBaseUrl || providers[state.selectedProvider]?.baseURL || ''
      }

      if (state.selectedProvider === 'anthropic') {
        try {
          const anthropic = new Anthropic({
            apiKey: state.apiKey,
            baseURL: testBaseURL,
          })

          await anthropic.messages.create({
            model: state.selectedModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          actions.setConnectionTestResult({
            success: true,
            message: '✅ Connection test successful',
            endpoint: `${testBaseURL}/v1/messages`,
          })

          setTimeout(() => {
            actions.setScreen('confirmation')
          }, 2000)
        } catch (error) {
          actions.setConnectionTestResult({
            success: false,
            message: '❌ Connection test failed',
            endpoint: `${testBaseURL}/v1/messages`,
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      } else if (state.selectedProvider === 'ollama') {
        actions.setConnectionTestResult({
          success: true,
          message: '✅ Configuration ready (connection test skipped for Ollama)',
        })
        setTimeout(() => {
          actions.setScreen('confirmation')
        }, 2000)
      } else {
        try {
          const openai = new OpenAI({
            apiKey: state.apiKey,
            baseURL: testBaseURL,
          })

          await openai.chat.completions.create({
            model: state.selectedModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          actions.setConnectionTestResult({
            success: true,
            message: '✅ Connection test successful',
            endpoint: `${testBaseURL}/chat/completions`,
          })

          setTimeout(() => {
            actions.setScreen('confirmation')
          }, 2000)
        } catch (error) {
          actions.setConnectionTestResult({
            success: false,
            message: '❌ Connection test failed',
            endpoint: `${testBaseURL}/chat/completions`,
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    } catch (error) {
      actions.setConnectionTestResult({
        success: false,
        message: 'Connection test failed',
        details: error instanceof Error ? error.message : String(error),
      })
    } finally {
      actions.setTestingConnection(false)
    }
  }, [actions, state])

  const handleConfirmation = useCallback(() => {
    const baseURL =
      state.selectedProvider === 'custom-openai' ? state.customBaseUrl : state.providerBaseUrl

    const updatedConfig = {
      ...getGlobalConfig(),
      model: {
        provider: state.selectedProvider,
        baseURL: baseURL,
        apiKey: state.apiKey,
        name: state.selectedModel,
        maxTokens: parseInt(state.maxTokens) || DEFAULT_MAX_TOKENS,
        contextLength: state.contextLength,
        reasoningEffort: state.reasoningEffort || undefined,
      },
    }
    saveGlobalConfig(updatedConfig)
    onDone()
  }, [state, onDone])

  // Render current screen
  switch (state.screen) {
    case 'provider':
      return <ProviderSelectionStep onSelect={handleProviderSelection} />

    case 'partnerProviders':
      return <PartnerProvidersStep onSelect={handleProviderSelection} />

    case 'partnerCodingPlans':
      return <PartnerCodingPlansStep onSelect={handleProviderSelection} />

    case 'baseUrl':
      if (state.selectedProvider === 'custom-openai') {
        return (
          <BaseUrlStep
            provider={state.selectedProvider}
            value={state.customBaseUrl}
            onChange={actions.setCustomBaseUrl}
            onSubmit={handleCustomBaseUrlSubmit}
            isLoading={state.isLoadingModels}
            error={state.modelLoadError}
          />
        )
      }
      return (
        <BaseUrlStep
          provider={state.selectedProvider}
          value={state.providerBaseUrl}
          onChange={actions.setProviderBaseUrl}
          onSubmit={handleBaseUrlSubmit}
          isLoading={state.isLoadingModels}
          error={state.modelLoadError}
        />
      )

    case 'apiKey':
      return (
        <ApiKeyStep
          provider={state.selectedProvider}
          value={state.apiKey}
          onChange={actions.setApiKey}
          onSubmit={handleApiKeySubmit}
          isLoading={state.isLoadingModels}
          error={state.modelLoadError}
          showCleanedNotification={state.apiKeyCleanedNotification}
          baseUrl={state.customBaseUrl || state.providerBaseUrl}
        />
      )

    case 'resourceName':
      return (
        <ResourceNameStep
          value={state.resourceName}
          onChange={actions.setResourceName}
          onSubmit={handleResourceNameSubmit}
        />
      )

    case 'model':
      return (
        <ModelSelectionStep
          provider={state.selectedProvider}
          models={availableModels}
          onSelect={handleModelSelection}
        />
      )

    case 'modelInput':
      return (
        <ModelInputStep
          provider={state.selectedProvider}
          value={state.customModelName}
          onChange={actions.setCustomModel}
          onSubmit={handleCustomModelSubmit}
          error={state.modelLoadError}
          resourceName={state.resourceName}
        />
      )

    case 'modelParams':
      return (
        <ModelParamsStep
          modelName={state.selectedModel}
          maxTokens={state.maxTokens}
          reasoningEffort={state.reasoningEffort}
          supportsReasoningEffort={state.supportsReasoningEffort}
          activeFieldIndex={state.activeFieldIndex}
          onMaxTokensChange={(tokens, preset) => actions.setMaxTokens(tokens, preset)}
          onReasoningEffortChange={actions.setReasoningEffort}
          onSubmit={handleModelParamsSubmit}
        />
      )

    case 'contextLength':
      return (
        <ContextLengthStep value={state.contextLength} onSubmit={handleContextLengthSubmit} />
      )

    case 'connectionTest':
      return (
        <ConnectionTestStep
          providerName={providers[state.selectedProvider]?.name || state.selectedProvider}
          isTestingConnection={state.isTestingConnection}
          result={state.connectionTestResult}
          onTest={handleConnectionTest}
        />
      )

    case 'confirmation':
      return (
        <ConfirmationStep
          provider={state.selectedProvider}
          modelName={state.selectedModel}
          maxTokens={parseInt(state.maxTokens)}
          contextLength={state.contextLength}
          reasoningEffort={state.reasoningEffort}
          onConfirm={handleConfirmation}
        />
      )

    default:
      return <ProviderSelectionStep onSelect={handleProviderSelection} />
  }
}
