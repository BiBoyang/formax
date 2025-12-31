import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getGlobalConfig, getActiveModelProfile } from '../utils/config'

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
  const profile = getActiveModelProfile(config)

  if (!profile?.provider || !profile?.apiKey || !profile?.modelName) {
    throw new Error(
      'Model configuration is incomplete. Please complete the onboarding process.',
    )
  }

  const { messages, onProgress } = options
  const {
    provider,
    apiKey,
    baseURL,
    modelName,
    maxTokens,
  } = {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    modelName: profile.modelName,
    maxTokens: profile.maxTokens,
  }

  const normalizedBase = (baseURL || (provider === 'anthropic' ? 'https://api.anthropic.com' : ''))
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')

  try {
    if (provider === 'anthropic' || provider === 'custom-anthropic') {
      // Convert messages to Anthropic format
      const anthropicMessages = messages.map((msg) => {
        if (msg.role === 'user') {
          return { role: 'user' as const, content: msg.content }
        } else {
          return { role: 'assistant' as const, content: msg.content }
        }
      })

      const anthropic = new Anthropic({
        apiKey: apiKey,
        baseURL: normalizedBase || 'https://api.anthropic.com',
        defaultHeaders: {
          // 某些 Anthropic 兼容服务需要 Authorization 头
          Authorization: `Bearer ${apiKey}`,
        },
      })

      const body = {
        model: modelName,
        max_tokens: maxTokens || 8192,
        messages: anthropicMessages,
      }

      try {
        const response = await anthropic.messages.create(body)

        const content =
          typeof response.content[0] === 'object' &&
          'text' in response.content[0]
            ? response.content[0].text
            : String(response.content[0])

        return content
      } catch (sdkError) {
        // 如果 SDK 401，尝试使用 fetch 兼容更多网关
        if (sdkError instanceof Error && sdkError.message.includes('401')) {
          const endpoint = `${normalizedBase || 'https://api.anthropic.com'}/v1/messages`
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              Authorization: `Bearer ${apiKey}`,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
          })

          if (!resp.ok) {
            const text = await resp.text()
            throw new Error(text || `Anthropic-compatible request failed: ${resp.status} ${resp.statusText}`)
          }

          const data = (await resp.json()) as any
          const firstContent = data?.content?.[0]
          const contentText =
            typeof firstContent === 'object' && firstContent?.text
              ? firstContent.text
              : typeof firstContent === 'string'
                ? firstContent
                : ''

          if (!contentText) {
            throw new Error('Empty response from Anthropic-compatible API')
          }

          return contentText
        }

        throw sdkError
      }
    } else {
      // OpenAI-compatible API (including custom-openai, openai, etc.)
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: normalizedBase || 'https://api.openai.com/v1',
        dangerouslyAllowBrowser: true,
      })

      // Convert messages to OpenAI format
      const openaiMessages = messages.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })) as Array<{ role: 'user' | 'assistant'; content: string }>

      const response = await openai.chat.completions.create({
        model: modelName,
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
