import { describe, expect, it } from 'vitest'
import { resolveRuntimeModelProfile } from './runtimeModelProfile.js'
import type { RuntimeConfig } from './config.js'

type RuntimeConfigOverrides = {
  llm?: Partial<RuntimeConfig['llm']>
  paths?: Partial<RuntimeConfig['paths']>
  context?: Partial<RuntimeConfig['context']>
  ui?: Partial<RuntimeConfig['ui']>
}

function createRuntimeConfig(overrides?: RuntimeConfigOverrides): RuntimeConfig {
  return {
    llm: {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      modelSource: 'tier_model',
      defaultTier: 'sonnet',
      timeoutMs: 600000,
      thinkingMode: true,
      ...overrides?.llm,
    },
    paths: {
      logsDir: '/tmp/logs',
      subagentsDir: '/tmp/agents',
      planDir: '/tmp/plans',
      ...overrides?.paths,
    },
    context: {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 12000,
      compactKeepLastTurns: 4,
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 8,
      ...overrides?.context,
    },
    ui: {
      assistantTextMode: 'buffered',
      showContextMeter: true,
      showAutoCompactNotice: true,
      outputStyle: 'default',
      verboseOutput: false,
      ...overrides?.ui,
    },
  }
}

describe('resolveRuntimeModelProfile', () => {
  it('preserves persisted capability source and binding when the tier snapshot matches', () => {
    const profile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          contextWindowTokens: 200000,
          contextWindowTokensSource: 'provider_detail',
          tierContextWindowBindings: {
            haiku: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-haiku',
            },
            sonnet: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-5-sonnet',
            },
            opus: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-opus',
            },
          },
        },
      }),
      runtimeFlagFingerprint: 'flags:v1',
    })

    expect(profile.contextWindowTokens).toBe(200000)
    expect(profile.contextWindowTokensSource).toBe('provider_detail')
    expect(profile.contextWindowTokensBoundModel).toBe('claude-3-5-sonnet')
    expect(profile.contextWindowTokensBinding).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet',
    })
    expect(profile.fingerprint).toContain('"runtimeFlagFingerprint":"flags:v1"')
  })

  it('falls back to known_model_map when the stored tier binding mismatches the active model', () => {
    const profile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          model: 'claude-3-5-sonnet-v2',
          contextWindowTokens: undefined,
          contextWindowTokensSource: 'binding_mismatch',
          tierContextWindowBindings: {
            haiku: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-haiku',
            },
            sonnet: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-5-sonnet',
            },
            opus: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-opus',
            },
          },
        },
      }),
    })

    expect(profile.contextWindowTokens).toBe(200000)
    expect(profile.contextWindowTokensSource).toBe('known_model_map')
    expect(profile.contextWindowTokensBoundModel).toBeUndefined()
  })

  it('preserves the legacy scalar fallback when tier binding mismatch already occurred upstream', () => {
    const profile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          model: 'claude-3-5-sonnet-v2',
          contextWindowTokens: 64000,
          contextWindowTokensSource: 'binding_mismatch',
          tierContextWindowBindings: {
            haiku: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-haiku',
            },
            sonnet: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-5-sonnet',
            },
            opus: {
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.com/v1',
              model: 'claude-3-opus',
            },
          },
        },
      }),
    })

    expect(profile.contextWindowTokens).toBe(64000)
    expect(profile.contextWindowTokensSource).toBe('legacy_config')
  })

  it('keeps binding_mismatch when no known model map fallback exists', () => {
    const profile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          provider: 'openai',
          model: 'unknown-openai-model',
          contextWindowTokens: undefined,
          contextWindowTokensSource: 'binding_mismatch',
        },
      }),
    })

    expect(profile.contextWindowTokens).toBeUndefined()
    expect(profile.contextWindowTokensSource).toBe('binding_mismatch')
  })

  it('changes the runtime fingerprint when apiKey or timeout changes', () => {
    const baseProfile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig(),
    })
    const rotatedKeyProfile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          apiKey: 'sk-rotated',
        },
      }),
    })
    const timeoutProfile = resolveRuntimeModelProfile({
      cfg: createRuntimeConfig({
        llm: {
          timeoutMs: 123456,
        },
      }),
    })

    expect(rotatedKeyProfile.fingerprint).not.toBe(baseProfile.fingerprint)
    expect(timeoutProfile.fingerprint).not.toBe(baseProfile.fingerprint)
    expect(rotatedKeyProfile.fingerprint).not.toContain('sk-rotated')
  })
})
