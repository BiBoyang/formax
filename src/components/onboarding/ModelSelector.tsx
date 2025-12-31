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

  // Resolve the active base URL for the selected provider
  const resolveBaseUrl = useCallback(() => {
    if (state.selectedProvider === 'custom-openai') {
      return state.customBaseUrl
    }
    if (state.selectedProvider === 'ollama') {
      return (
        state.providerBaseUrl ||
        providers[state.selectedProvider]?.baseURL ||
        'http://localhost:11434/v1'
      )
    }
    const providerDefault = providers[state.selectedProvider]?.baseURL || ''
    return state.providerBaseUrl || providerDefault
  }, [state.customBaseUrl, state.providerBaseUrl, state.selectedProvider])

  const ensureOpenAIBaseUrl = useCallback((url: string) => {
    const clean = (url || '').replace(/\/+$/, '')
    if (/\/v\d+$/.test(clean)) return clean
    return `${clean}/v1`
  }, [])

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
        const activeBaseUrl =
          resolveBaseUrl() ||
          providers[state.selectedProvider]?.baseURL ||
          ''

        if (state.selectedProvider === 'custom-openai') {
          const customModels = await fetchCustomModels(activeBaseUrl, cleanedKey)
          models = customModels.map((model: any) => ({
            model: model.modelName || model.id || model.name || model.model || 'unknown',
            provider: 'custom-openai',
            max_tokens: model.max_tokens || 4096,
            supports_vision: false,
            supports_function_calling: true,
            supports_reasoning_effort: false,
          }))
        } else if (state.selectedProvider === 'anthropic') {
          models = await fetchAnthropicModels(
            cleanedKey,
            activeBaseUrl || 'https://api.anthropic.com',
          )
        } else if (state.selectedProvider === 'openai') {
          models = await fetchOpenAIModels(cleanedKey)
        } else {
          const customModels = await fetchCustomModels(activeBaseUrl, cleanedKey)
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
    [actions, resolveBaseUrl, state.selectedProvider],
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
      const testBaseURL =
        resolveBaseUrl() ||
        providers[state.selectedProvider]?.baseURL ||
        ''

      if (state.selectedProvider === 'anthropic') {
        const normalizedBase = (testBaseURL || 'https://api.anthropic.com')
          .replace(/\/+$/, '')
          .replace(/\/v1$/, '')
        const endpoint = `${normalizedBase}/v1/messages`
        const testModel =
          state.selectedModel || state.customModelName || 'claude-3-5-haiku-latest'

        try {
          const anthropic = new Anthropic({
            apiKey: state.apiKey,
            baseURL: normalizedBase || 'https://api.anthropic.com',
          })

          await anthropic.messages.create({
            model: testModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          actions.setConnectionTestResult({
            success: true,
            message: '✅ Connection test successful',
            endpoint,
          })

          setTimeout(() => {
            actions.setScreen('confirmation')
          }, 2000)
        } catch (error) {
          // 尝试使用手动 fetch（同时带 x-api-key 与 Authorization）兼容更多 Anthropic-Compatible 服务
          try {
            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': state.apiKey,
                Authorization: `Bearer ${state.apiKey}`,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: testModel,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'test' }],
              }),
            })

            if (resp.ok) {
              actions.setConnectionTestResult({
                success: true,
                message: '✅ Connection test successful',
                endpoint,
              })
              setTimeout(() => {
                actions.setScreen('confirmation')
              }, 2000)
              return
            }

            const text = await resp.text()
            actions.setConnectionTestResult({
              success: false,
              message: '❌ Connection test failed',
              endpoint,
              details: text || (resp.statusText ? `${resp.status} ${resp.statusText}` : 'Unknown error'),
            })
          } catch (fallbackError) {
            actions.setConnectionTestResult({
              success: false,
              message: '❌ Connection test failed',
              endpoint,
              details:
                fallbackError instanceof Error
                  ? fallbackError.message
                  : error instanceof Error
                    ? error.message
                    : 'Unknown error',
            })
          }
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
          const openaiBase = ensureOpenAIBaseUrl(testBaseURL)
          const openai = new OpenAI({
            apiKey: state.apiKey,
            baseURL: openaiBase,
          })

          await openai.chat.completions.create({
            model: state.selectedModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          })

          actions.setConnectionTestResult({
            success: true,
            message: '✅ Connection test successful',
            endpoint: `${openaiBase}/chat/completions`,
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
  }, [actions, resolveBaseUrl, state])

  const handleConfirmation = useCallback(() => {
    const baseURL = resolveBaseUrl()
    const existingConfig = getGlobalConfig()
    const modelName =
      state.selectedModel || state.customModelName || state.selectedProvider

    const modelProfile = {
      name: `${providers[state.selectedProvider]?.name || state.selectedProvider} ${modelName}`.trim(),
      provider: state.selectedProvider,
      modelName,
      baseURL: baseURL || undefined,
      apiKey: state.apiKey,
      maxTokens: parseInt(state.maxTokens) || DEFAULT_MAX_TOKENS,
      contextLength: state.contextLength,
      reasoningEffort: state.reasoningEffort || undefined,
      isActive: true,
      createdAt: Date.now(),
    }

    // Replace any existing profile with the same modelName or name
    const existingProfiles = existingConfig.modelProfiles ?? []
    const filteredProfiles = existingProfiles.filter(
      (profile) =>
        profile.modelName !== modelProfile.modelName && profile.name !== modelProfile.name,
    )

    const updatedConfig = {
      ...existingConfig,
      modelProfiles: [...filteredProfiles, modelProfile],
      modelPointers: {
        ...(existingConfig.modelPointers ?? {
          main: '',
          task: '',
          reasoning: '',
          quick: '',
        }),
        main: modelProfile.modelName,
        task: modelProfile.modelName,
        reasoning: modelProfile.modelName,
        quick: modelProfile.modelName,
      },
      defaultModelName: modelProfile.modelName,
      primaryProvider: state.selectedProvider,
      // Keep legacy model field for backward compatibility
      model: {
        provider: state.selectedProvider,
        baseURL: baseURL || undefined,
        apiKey: state.apiKey,
        name: modelName,
        maxTokens: parseInt(state.maxTokens) || DEFAULT_MAX_TOKENS,
        contextLength: state.contextLength,
        reasoningEffort: state.reasoningEffort || undefined,
      },
    }
    saveGlobalConfig(updatedConfig)
    onDone()
  }, [onDone, resolveBaseUrl, state])

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
