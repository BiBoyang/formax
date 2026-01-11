import { describe, expect, it } from 'vitest'
import { AuthStoreV1Schema, FormaxConfigV1Schema } from './schema'

describe('FormaxConfigV1Schema', () => {
  it('fills defaults for an empty object', () => {
    const cfg = FormaxConfigV1Schema.parse({})
    expect(cfg).toEqual({
      version: 1,
      llm: {
        provider: 'anthropic',
        baseUrl: '',
        model: '',
        timeoutMs: 600000,
        authRef: 'default',
      },
      paths: {},
      ui: {
        assistantTextMode: 'buffered',
        promptProfile: 'full',
      },
    })
  })

  it('rejects unknown fields', () => {
    expect(() => FormaxConfigV1Schema.parse({ version: 1, extra: true })).toThrow()
  })
})

describe('AuthStoreV1Schema', () => {
  it('parses a provider keyed store', () => {
    const store = AuthStoreV1Schema.parse({
      version: 1,
      providers: {
        anthropic: {
          default: { apiKey: 'sk-ant-123' },
        },
      },
    })

    expect(store.providers.anthropic?.default.apiKey).toBe('sk-ant-123')
  })

  it('rejects unknown provider keys', () => {
    expect(() =>
      AuthStoreV1Schema.parse({
        version: 1,
        providers: {
          foo: {},
        },
      }),
    ).toThrow()
  })
})

