import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export type ModelInfo = {
  model: string
  provider: string
  max_tokens?: number
  contextWindowTokens?: number
  supports_reasoning_effort?: boolean
  supports_vision?: boolean
  supports_function_calling?: boolean
}

/**
 * Fetch available models from Anthropic API
 */
export async function fetchAnthropicModels(
  apiKey: string,
  baseURL?: string,
): Promise<ModelInfo[]> {
  const normalizedBase = (baseURL || 'https://api.anthropic.com').replace(/\/+$/, '')
  // Avoid double-appending /v1 when we probe endpoints
  const apiBase = normalizedBase.replace(/\/v1$/, '')
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  // Try to fetch models from Anthropic-compatible /v1/models if available
  try {
    const response = await fetch(`${apiBase}/v1/models`, {
      method: 'GET',
      headers,
    })

    if (response.ok) {
      const data = await response.json()
      const modelsData = Array.isArray((data as any)?.data)
        ? (data as any).data
        : Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.models)
            ? (data as any).models
            : []

      if (Array.isArray(modelsData) && modelsData.length > 0) {
        return modelsData.map((model: any) => ({
          model: model.modelName || model.id || model.name || model.model || 'unknown',
          provider: 'anthropic',
          max_tokens: model.max_tokens || model.context_length || 8192,
          contextWindowTokens: model.context_length || model.context_window || model.max_tokens,
          supports_reasoning_effort: false,
          supports_vision: Boolean(model.supports_vision ?? true),
          supports_function_calling: model.supports_function_calling ?? true,
        }))
      }
    }
  } catch (error) {
    console.error('Failed to fetch Anthropic-compatible models:', error)
    // Fall back to default list below
  }

  try {
    const anthropic = new Anthropic({
      apiKey: apiKey,
      baseURL: apiBase,
    })

    // Anthropic doesn't have a models.list() endpoint, so we return common models
    // These are the standard Claude models available with metadata
    const commonModels: ModelInfo[] = [
      {
        model: 'claude-3-5-sonnet-latest',
        provider: 'anthropic',
        max_tokens: 8192,
        contextWindowTokens: 200000,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
      {
        model: 'claude-3-5-haiku-latest',
        provider: 'anthropic',
        max_tokens: 8192,
        contextWindowTokens: 200000,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
      {
        model: 'claude-3-opus-latest',
        provider: 'anthropic',
        max_tokens: 4096,
        contextWindowTokens: 200000,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
      {
        model: 'claude-3-sonnet-latest',
        provider: 'anthropic',
        max_tokens: 4096,
        contextWindowTokens: 200000,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
      {
        model: 'claude-3-haiku-latest',
        provider: 'anthropic',
        max_tokens: 4096,
        contextWindowTokens: 200000,
        supports_reasoning_effort: false,
        supports_vision: true,
        supports_function_calling: true,
      },
    ]

    // Test the API key by making a simple request using the provided base URL
    try {
      await anthropic.messages.create({
        model: commonModels[0].model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('authentication')) {
          throw new Error('Invalid API key. Please check your API key and try again.')
        }
        if (error.message.includes('403')) {
          throw new Error('API key does not have permission to access models.')
        }
        throw new Error(`API error: ${error.message}`)
      }
      throw error
    }

    return commonModels
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        throw new Error(
          'Unable to connect to the API. Please check your internet connection.',
        )
      }
      throw error
    }
    throw new Error('Failed to fetch Anthropic models')
  }
}

/**
 * Fetch available models from OpenAI API
 */
export async function fetchOpenAIModels(
  apiKey: string,
): Promise<ModelInfo[]> {
  try {
    const openai = new OpenAI({
      apiKey: apiKey,
    })

    const response = await openai.models.list()

    // Reference model metadata from Kode-cli's models.ts
    const modelMetadata: Record<
      string,
      {
        max_tokens: number
        supports_reasoning_effort: boolean
        contextWindowTokens?: number
      }
    > = {
      'gpt-4o': { max_tokens: 16384, supports_reasoning_effort: false, contextWindowTokens: 128000 },
      'gpt-4-turbo': { max_tokens: 4096, supports_reasoning_effort: false, contextWindowTokens: 128000 },
      'gpt-4': { max_tokens: 4096, supports_reasoning_effort: false, contextWindowTokens: 8192 },
      'gpt-3.5-turbo': { max_tokens: 4096, supports_reasoning_effort: false, contextWindowTokens: 16385 },
      'o1': { max_tokens: 100000, supports_reasoning_effort: true },
      'o1-preview': { max_tokens: 100000, supports_reasoning_effort: true },
      'o1-mini': { max_tokens: 100000, supports_reasoning_effort: true },
      'o3-mini': { max_tokens: 100000, supports_reasoning_effort: true },
    }

    const models: ModelInfo[] = response.data
      .filter((model) => {
        // Filter to only include chat models
        const modelId = model.id
        return (
          modelId.includes('gpt-') ||
          modelId.includes('o1-') ||
          modelId.includes('o3-')
        )
      })
      .map((model) => {
        const modelId = model.id
        // Find matching metadata (check if modelId starts with any key)
        const metadataKey = Object.keys(modelMetadata).find((key) =>
          modelId.startsWith(key),
        )
        const metadata = metadataKey ? modelMetadata[metadataKey] : null

        return {
          model: modelId,
          provider: 'openai',
          max_tokens: metadata?.max_tokens || 8192,
          contextWindowTokens: metadata?.contextWindowTokens,
          supports_reasoning_effort: metadata?.supports_reasoning_effort || false,
          supports_vision: modelId.includes('gpt-4o') || modelId.includes('gpt-4-turbo'),
          supports_function_calling: true,
        }
      })

    if (models.length === 0) {
      // Fallback to common models if API doesn't return any
      return [
        {
          model: 'gpt-4o',
          provider: 'openai',
          max_tokens: 16384,
          contextWindowTokens: 128000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'gpt-4-turbo',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 128000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'gpt-4',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 8192,
          supports_reasoning_effort: false,
          supports_vision: false,
          supports_function_calling: true,
        },
        {
          model: 'gpt-3.5-turbo',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 16385,
          supports_reasoning_effort: false,
          supports_vision: false,
          supports_function_calling: true,
        },
      ]
    }

    return models
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('authentication')) {
        throw new Error('Invalid API key. Please check your API key and try again.')
      }
      if (error.message.includes('403')) {
        throw new Error('API key does not have permission to access models.')
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        throw new Error(
          'Unable to connect to the API. Please check your internet connection.',
        )
      }
      throw new Error(`API error: ${error.message}`)
    }
    throw new Error('Failed to fetch OpenAI models')
  }
}

/**
 * Fetch models from a custom OpenAI-compatible API
 */
export async function fetchCustomModels(
  baseURL: string,
  apiKey: string,
): Promise<any[]> {
  try {
    // Check if baseURL already contains version number (e.g., v1, v2, etc.)
    const hasVersionNumber = /\/v\d+/.test(baseURL)
    const cleanBaseURL = baseURL.replace(/\/+$/, '')
    const modelsURL = hasVersionNumber
      ? `${cleanBaseURL}/models`
      : `${cleanBaseURL}/v1/models`

    const response = await fetch(modelsURL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      // Provide user-friendly error messages based on status code
      if (response.status === 401) {
        throw new Error(
          'Invalid API key. Please check your API key and try again.',
        )
      } else if (response.status === 403) {
        throw new Error(
          'API key does not have permission to access models. Please check your API key permissions.',
        )
      } else if (response.status === 404) {
        throw new Error(
          'API endpoint not found. Please check if the base URL is correct and supports the /models endpoint.',
        )
      } else if (response.status === 429) {
        throw new Error(
          'Too many requests. Please wait a moment and try again.',
        )
      } else if (response.status >= 500) {
        throw new Error(
          'API service is temporarily unavailable. Please try again later.',
        )
      } else {
        throw new Error(
          `Unable to connect to API (${response.status}). Please check your base URL, API key, and internet connection.`,
        )
      }
    }

    const data = await response.json()

    // Type guards for different API response formats
    const hasDataArray = (obj: unknown): obj is { data: unknown[] } => {
      return typeof obj === 'object' && obj !== null && 'data' in obj && Array.isArray((obj as any).data)
    }
    
    const hasModelsArray = (obj: unknown): obj is { models: unknown[] } => {
      return typeof obj === 'object' && obj !== null && 'models' in obj && Array.isArray((obj as any).models)
    }

    // Validate response format and extract models array
    let models = []

    if (hasDataArray(data)) {
      // Standard OpenAI format: { data: [...] }
      models = data.data
    } else if (Array.isArray(data)) {
      // Direct array format
      models = data
    } else if (hasModelsArray(data)) {
      // Alternative format: { models: [...] }
      models = data.models
    } else {
      throw new Error(
        'API returned unexpected response format. Expected an array of models or an object with a "data" or "models" array.',
      )
    }

    return models
  } catch (error) {
    // If it's already our custom error, pass it through
    if (
      error instanceof Error &&
      (error.message.includes('API key') ||
        error.message.includes('API endpoint') ||
        error.message.includes('API service') ||
        error.message.includes('response format'))
    ) {
      throw error
    }

    // For network errors or other issues
    console.error('Failed to fetch custom API models:', error)

    // Check if it's a network error
    if (error instanceof Error && (error.message.includes('fetch') || error.message.includes('network'))) {
      throw new Error(
        'Unable to connect to the API. Please check your internet connection and base URL.',
      )
    }

    throw new Error(
      `Failed to fetch custom API models: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Get default models for a provider (used as fallback)
 */
export function getDefaultModels(provider: string): ModelInfo[] {
  switch (provider) {
    case 'anthropic':
      return [
        {
          model: 'claude-3-5-sonnet-latest',
          provider: 'anthropic',
          max_tokens: 8192,
          contextWindowTokens: 200000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'claude-3-5-haiku-latest',
          provider: 'anthropic',
          max_tokens: 8192,
          contextWindowTokens: 200000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'claude-3-opus-latest',
          provider: 'anthropic',
          max_tokens: 4096,
          contextWindowTokens: 200000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
      ]
    case 'openai':
      return [
        {
          model: 'gpt-4o',
          provider: 'openai',
          max_tokens: 16384,
          contextWindowTokens: 128000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'gpt-4-turbo',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 128000,
          supports_reasoning_effort: false,
          supports_vision: true,
          supports_function_calling: true,
        },
        {
          model: 'gpt-4',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 8192,
          supports_reasoning_effort: false,
          supports_vision: false,
          supports_function_calling: true,
        },
        {
          model: 'gpt-3.5-turbo',
          provider: 'openai',
          max_tokens: 4096,
          contextWindowTokens: 16385,
          supports_reasoning_effort: false,
          supports_vision: false,
          supports_function_calling: true,
        },
      ]
    default:
      return []
  }
}
