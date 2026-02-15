import { describe, expect, it } from 'vitest'
import { createLlmClients } from './llmClients.js'
import { AnthropicStreamClient, OpenAIStreamClient } from '../../streaming/index.js'

describe('createLlmClients', () => {
  it('creates OpenAI stream clients when provider=openai', () => {
    const out = createLlmClients({
      cfg: {
        llm: {
          provider: 'openai',
          apiKey: 'k',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          timeoutMs: 1000,
          thinkingMode: false,
        },
      } as any,
      env: {} as any,
    })

    expect(out.client).toBeInstanceOf(OpenAIStreamClient)
    expect(out.webFetchClient).toBeInstanceOf(OpenAIStreamClient)
    expect(out.model).toBe('gpt-4o-mini')
  })

  it('creates Anthropic stream clients when provider=anthropic', () => {
    const out = createLlmClients({
      cfg: {
        llm: {
          provider: 'anthropic',
          apiKey: 'k',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-3-5-sonnet-latest',
          timeoutMs: 1000,
          thinkingMode: true,
        },
      } as any,
      env: {} as any,
    })

    expect(out.client).toBeInstanceOf(AnthropicStreamClient)
    expect(out.webFetchClient).toBeInstanceOf(AnthropicStreamClient)
    expect(out.model).toBe('claude-3-5-sonnet-latest')
  })

  it('throws when runtime config has empty model', () => {
    expect(() =>
      createLlmClients({
        cfg: {
          llm: {
            provider: 'openai',
            apiKey: 'k',
            baseUrl: 'https://api.openai.com/v1',
            model: '   ',
            timeoutMs: 1000,
            thinkingMode: false,
          },
        } as any,
        env: {} as any,
      }),
    ).toThrow('Missing llm.model in runtime config')
  })
})
