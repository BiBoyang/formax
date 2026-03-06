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
        defaultTier: 'sonnet',
        timeoutMs: 600000,
        authRef: 'default',
        thinkingMode: true,
      },
      paths: {},
      ui: {
        assistantTextMode: 'buffered',
        showContextMeter: true,
        showAutoCompactNotice: true,
        outputStyle: 'default',
        verboseOutput: false,
      },
      context: {
        effectiveContextWindowPercent: 0.95,
        autoCompactTokenLimitPercent: 0.9,
        baselineTokens: 12000,
        compactKeepLastTurns: 4,
        enableAutoCompact: true,
        autoCompactMinTurnsBetweenRuns: 8,
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
