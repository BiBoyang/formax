import { describe, expect, it } from 'vitest'
import type { RuntimeConfig } from '../../config/config.js'
import { getSetupConfiguredReason } from './configuredStatus.js'

function runtime(overrides: Partial<RuntimeConfig['llm']> = {}): RuntimeConfig {
  return {
    llm: {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-test',
      model: 'claude-sonnet',
      modelSource: 'legacy_sonnet_model',
      timeoutMs: 600000,
      thinkingMode: true,
      thinkingEffort: 'medium',
      ...overrides,
    },
    paths: {
      logsDir: '/tmp/logs',
      subagentsDir: '/tmp/agents',
      planDir: '/tmp/plans',
    },
    context: {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 12000,
      compactKeepLastTurns: 4,
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 8,
    },
    ui: {
      assistantTextMode: 'buffered',
      showContextMeter: true,
      showAutoCompactNotice: true,
      outputStyle: 'default',
      verboseOutput: false,
    },
  }
}

describe('getSetupConfiguredReason', () => {
  it('reports missing fields before configured', () => {
    expect(getSetupConfiguredReason({ configLoadError: new Error('invalid') })).toBe('invalid_config')
    expect(getSetupConfiguredReason({ runtime: runtime({ apiKey: '' }) })).toBe('missing_api_key')
    expect(getSetupConfiguredReason({ runtime: runtime({ baseUrl: '' }) })).toBe('missing_base_url')
    expect(getSetupConfiguredReason({ runtime: runtime({ model: '' }) })).toBe('missing_model')
  })

  it('requires an explicit model source for the active/default tier', () => {
    expect(getSetupConfiguredReason({ runtime: runtime({ modelSource: 'default_model' }) })).toBe('missing_model')
    expect(getSetupConfiguredReason({ runtime: runtime({ modelSource: 'tier_env' }) })).toBe('configured')
    expect(getSetupConfiguredReason({ runtime: runtime({ modelSource: 'tier_model' }) })).toBe('configured')
    expect(getSetupConfiguredReason({ runtime: runtime({ modelSource: 'legacy_sonnet_model' }) })).toBe('configured')
  })
})
