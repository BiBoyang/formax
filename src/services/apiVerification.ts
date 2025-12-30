import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

/**
 * Verify API key for Anthropic provider
 */
export async function verifyAnthropicApiKey(
  apiKey: string,
  baseURL?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: 'API key is required' }
  }

  try {
    const anthropic = new Anthropic({
      apiKey: apiKey,
      ...(baseURL && { baseURL }),
    })

    // Test the API key by making a minimal request
    await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'test' }],
    })

    return { valid: true }
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message.includes('401') ||
        error.message.includes('authentication') ||
        error.message.includes('invalid x-api-key')
      ) {
        return {
          valid: false,
          error: 'Invalid API key. Please check your API key and try again.',
        }
      }
      if (error.message.includes('403')) {
        return {
          valid: false,
          error: 'API key does not have permission to access models.',
        }
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return {
          valid: false,
          error:
            'Unable to connect to the API. Please check your internet connection and base URL.',
        }
      }
      return {
        valid: false,
        error: `API error: ${error.message}`,
      }
    }
    return {
      valid: false,
      error: 'Unknown error occurred while verifying API key',
    }
  }
}

/**
 * Verify API key for OpenAI-compatible providers
 */
export async function verifyOpenAIApiKey(
  apiKey: string,
  baseURL?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: 'API key is required' }
  }

  try {
    const openai = new OpenAI({
      apiKey: apiKey,
      ...(baseURL && { baseURL }),
    })

    // Test the API key by listing models
    await openai.models.list()

    return { valid: true }
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message.includes('401') ||
        error.message.includes('authentication') ||
        error.message.includes('Invalid API key')
      ) {
        return {
          valid: false,
          error: 'Invalid API key. Please check your API key and try again.',
        }
      }
      if (error.message.includes('403')) {
        return {
          valid: false,
          error: 'API key does not have permission to access models.',
        }
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return {
          valid: false,
          error:
            'Unable to connect to the API. Please check your internet connection and base URL.',
        }
      }
      return {
        valid: false,
        error: `API error: ${error.message}`,
      }
    }
    return {
      valid: false,
      error: 'Unknown error occurred while verifying API key',
    }
  }
}

/**
 * Verify API key based on provider type
 */
export async function verifyApiKey(
  provider: string,
  apiKey: string,
  baseURL?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (provider === 'anthropic') {
    return await verifyAnthropicApiKey(apiKey, baseURL)
  } else if (
    provider === 'openai' ||
    provider === 'custom-openai' ||
    provider === 'kimi' ||
    provider === 'deepseek' ||
    provider === 'qwen' ||
    provider === 'minimax' ||
    provider === 'siliconflow' ||
    provider === 'glm' ||
    provider === 'baidu-qianfan' ||
    provider === 'mistral' ||
    provider === 'xai' ||
    provider === 'groq' ||
    provider === 'openrouter'
  ) {
    return await verifyOpenAIApiKey(apiKey, baseURL)
  } else if (provider === 'ollama') {
    // Ollama doesn't require API key verification
    return { valid: true }
  } else {
    // For unknown providers, skip verification
    return { valid: true }
  }
}

