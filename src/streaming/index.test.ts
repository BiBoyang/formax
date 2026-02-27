import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropicCtor: vi.fn(function (this: unknown, args: any) {
    return { kind: 'anthropic', args }
  }),
  openaiCtor: vi.fn(function (this: unknown, args: any) {
    return { kind: 'openai', args }
  }),
}))

vi.mock('./anthropic/StreamClient.js', () => ({
  AnthropicStreamClient: mocks.anthropicCtor,
}))

vi.mock('./openai/StreamClient.js', () => ({
  OpenAIStreamClient: mocks.openaiCtor,
}))

import { createAnthropicCompatibleStreamClient, createStreamClient } from './index'

describe('streaming/index', () => {
  it('creates anthropic stream client', () => {
    const out = createAnthropicCompatibleStreamClient({
      provider: 'anthropic',
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      model: 'claude',
      timeoutMs: 1000,
    })

    expect(mocks.anthropicCtor).toHaveBeenCalledWith({
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      model: 'claude',
      timeoutMs: 1000,
    })
    expect(out).toEqual({ kind: 'anthropic', args: expect.any(Object) })
  })

  it('creates openai stream client and supports backward-compatible alias', () => {
    const out = createAnthropicCompatibleStreamClient({
      provider: 'openai',
      apiKey: 'k2',
      baseUrl: 'https://openai.example.com',
      model: 'gpt',
    })
    expect(mocks.openaiCtor).toHaveBeenCalledWith({
      apiKey: 'k2',
      baseUrl: 'https://openai.example.com',
      model: 'gpt',
      timeoutMs: undefined,
    })
    expect(out).toEqual({ kind: 'openai', args: expect.any(Object) })

    const aliasOut = createStreamClient({
      provider: 'anthropic',
      apiKey: 'a',
      baseUrl: 'https://anthropic.example.com',
      model: 'claude-3',
    })
    expect(aliasOut).toEqual({ kind: 'anthropic', args: expect.any(Object) })
  })

  it('throws for unsupported providers', () => {
    expect(() =>
      createAnthropicCompatibleStreamClient({
        provider: 'custom' as any,
        apiKey: 'x',
        baseUrl: 'https://custom',
        model: 'm',
      }),
    ).toThrow('Provider "custom" is not supported yet')
  })
})
