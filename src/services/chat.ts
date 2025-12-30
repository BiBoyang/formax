import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getGlobalConfig, type GlobalConfig } from '../utils/config'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export type SendMessageOptions = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  onProgress?: (content: string) => void
}

export async function sendMessage(
  options: SendMessageOptions,
): Promise<string> {
  const config = getGlobalConfig()
  const modelConfig = config.model

  if (!modelConfig?.provider || !modelConfig?.apiKey || !modelConfig?.name) {
    throw new Error(
      'Model configuration is incomplete. Please complete the onboarding process.',
    )
  }

  const { messages, onProgress } = options
  const { provider, apiKey, baseURL, name, maxTokens } = modelConfig

  try {
    if (provider === 'anthropic' || provider === 'custom-anthropic') {
      const anthropic = new Anthropic({
        apiKey: apiKey,
        baseURL: baseURL || 'https://api.anthropic.com',
      })

      // Convert messages to Anthropic format
      // Anthropic API expects messages in a specific format
      const anthropicMessages = messages.map((msg) => {
        if (msg.role === 'user') {
          return { role: 'user' as const, content: msg.content }
        } else {
          return { role: 'assistant' as const, content: msg.content }
        }
      })

      const response = await anthropic.messages.create({
        model: name,
        max_tokens: maxTokens || 8192,
        messages: anthropicMessages,
      })

      // Extract text content from response
      const content =
        typeof response.content[0] === 'object' &&
        'text' in response.content[0]
          ? response.content[0].text
          : String(response.content[0])

      return content
    } else {
      // OpenAI-compatible API (including custom-openai, openai, etc.)
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL || 'https://api.openai.com/v1',
        dangerouslyAllowBrowser: true,
      })

      // Convert messages to OpenAI format
      const openaiMessages = messages.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })) as Array<{ role: 'user' | 'assistant'; content: string }>

      const response = await openai.chat.completions.create({
        model: name,
        max_tokens: maxTokens || 8192,
        messages: openaiMessages,
      })

      const content = response.choices[0]?.message?.content || ''

      if (!content) {
        throw new Error('No content in response from API')
      }

      return content
    }
  } catch (error) {
    if (error instanceof Error) {
      // Provide user-friendly error messages
      if (error.message.includes('401') || error.message.includes('authentication')) {
        throw new Error('Invalid API key. Please check your API key in the configuration.')
      }
      if (error.message.includes('403')) {
        throw new Error('API key does not have permission. Please check your API key permissions.')
      }
      if (error.message.includes('429')) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.')
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        throw new Error('Network error. Please check your internet connection.')
      }
      throw error
    }
    throw new Error('Failed to send message to AI')
  }
}

