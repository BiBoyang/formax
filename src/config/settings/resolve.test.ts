import { describe, expect, it, vi } from 'vitest'
import { resolveRuntimeConfig } from './resolve'
import { FormaxConfigV1PatchSchema } from './schema'

describe('resolveRuntimeConfig', () => {
  it('applies precedence flags > env > project > global > defaults', () => {
    const res = resolveRuntimeConfig({
      defaults: { llm: { model: 'd' } },
      globalConfig: { llm: { model: 'g' } },
      projectConfig: { llm: { model: 'p' } },
      env: { FORMAX_BASE_URL: 'https://env.example.com' },
      flags: { llm: { model: 'f' } },
    })

    expect(res.config.llm.model).toBe('f')
    expect(res.sources['llm.model']).toBe('flags')
  })

  it('does not overwrite missing fields with defaults from intermediate sources', () => {
    const res = resolveRuntimeConfig({
      globalConfig: { llm: { model: 'g' } },
      projectConfig: {},
      env: {},
      flags: {},
    })

    expect(res.config.llm.model).toBe('g')
    expect(res.sources['llm.model']).toBe('global')
  })

  it('normalizes anthropic baseUrl to include /v1', () => {
    const res = resolveRuntimeConfig({
      env: { FORMAX_BASE_URL: 'https://api.anthropic.com' },
    })

    expect(res.config.llm.baseUrl).toBe('https://api.anthropic.com/v1')
    expect(res.sources['llm.baseUrl']).toBe('env')
  })

  it('does not force provider to anthropic when env only sets baseUrl/timeout', () => {
    const res = resolveRuntimeConfig({
      projectConfig: { llm: { provider: 'openai' } },
      env: { FORMAX_BASE_URL: 'https://openai.example.com/v1', FORMAX_TIMEOUT_MS: '1234' },
    })

    expect(res.config.llm.provider).toBe('openai')
    expect(res.config.llm.baseUrl).toBe('https://openai.example.com/v1')
    expect(res.config.llm.timeoutMs).toBe(1234)
  })

  it('preserves explicit versioned env baseUrl (e.g. /v2)', () => {
    const res = resolveRuntimeConfig({
      projectConfig: { llm: { provider: 'openai' } },
      env: { FORMAX_BASE_URL: 'https://openai.example.com/v2' },
    })

    expect(res.config.llm.provider).toBe('openai')
    expect(res.config.llm.baseUrl).toBe('https://openai.example.com/v2')
  })

  it('preserves env baseUrl when already normalized to /v1', () => {
    const res = resolveRuntimeConfig({
      env: { FORMAX_BASE_URL: 'https://api.anthropic.com/v1' },
    })

    expect(res.config.llm.baseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('exposes env auth when FORMAX_API_KEY is present', () => {
    const res = resolveRuntimeConfig({
      env: { FORMAX_API_KEY: 'sk-ant-123' },
    })

    expect(res.auth?.provider).toBe('anthropic')
    expect(res.auth?.apiKey).toBe('sk-ant-123')
    expect(res.auth?.source).toBe('env')
  })

  it('uses auth store when env auth is missing', () => {
    const res = resolveRuntimeConfig({
      authStore: {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-default' },
            alt: { apiKey: 'sk-alt' },
          },
        },
      },
      projectConfig: { llm: { authRef: 'alt' } },
    })

    expect(res.auth?.provider).toBe('anthropic')
    expect(res.auth?.apiKey).toBe('sk-alt')
    expect(res.auth?.source).toBe('global')
  })

  it('warns when configured authRef is not found in auth store', () => {
    const res = resolveRuntimeConfig({
      authStore: {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-default' },
          },
        },
      },
      projectConfig: { llm: { authRef: 'missing' } },
    })

    expect(res.auth).toBeNull()
    expect(res.warnings.some((w) => w.includes('auth ref "missing" not found'))).toBe(true)
  })

  it('returns null auth when provider bucket is absent in auth store', () => {
    const res = resolveRuntimeConfig({
      authStore: {
        version: 1,
        providers: {
          openai: {
            default: { apiKey: 'sk-openai' },
          },
        },
      },
    })

    expect(res.auth).toBeNull()
  })

  it('warns when auth store is invalid', () => {
    const res = resolveRuntimeConfig({
      authStore: {
        version: 2,
        providers: {},
      } as any,
    })

    expect(res.auth).toBeNull()
    expect(res.warnings.some((w) => w.includes('auth store is invalid and was ignored'))).toBe(true)
  })

  it('prefers env auth over auth store', () => {
    const res = resolveRuntimeConfig({
      authStore: {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-file' },
          },
        },
      },
      env: { FORMAX_API_KEY: 'sk-env' },
    })

    expect(res.auth?.provider).toBe('anthropic')
    expect(res.auth?.apiKey).toBe('sk-env')
    expect(res.auth?.source).toBe('env')
  })

  it('fills source map for defaulted fields', () => {
    const res = resolveRuntimeConfig({})
    expect(res.sources['llm.provider']).toBe('default')
    expect(res.sources['llm.defaultTier']).toBe('default')
  })

  it('ignores invalid FORMAX_TIMEOUT_MS with warning', () => {
    const res = resolveRuntimeConfig({
      env: { FORMAX_TIMEOUT_MS: '-1' },
      projectConfig: { llm: { model: 'x' } },
    })

    expect(res.config.llm.model).toBe('x')
    expect(res.config.llm.timeoutMs).toBe(600000)
    expect(res.sources['llm.timeoutMs']).toBe('default')
    expect(res.warnings.some((w) => w.includes('FORMAX_TIMEOUT_MS'))).toBe(true)
  })

  it('ignores FORMAX_ENABLE_AUTO_COMPACT env override', () => {
    const res = resolveRuntimeConfig({
      env: { FORMAX_ENABLE_AUTO_COMPACT: '0' },
    })

    expect(res.config.context.enableAutoCompact).toBe(true)
    expect(res.sources['context.enableAutoCompact']).toBe('default')
    expect(res.warnings.some((w) => w.includes('FORMAX_ENABLE_AUTO_COMPACT'))).toBe(false)
  })

  it('adds a warning and ignores invalid patches', () => {
    const res = resolveRuntimeConfig({
      globalConfig: { llm: { timeoutMs: 'nope' } },
      projectConfig: { llm: { model: 'p' } },
    })

    expect(res.config.llm.model).toBe('p')
    expect(res.warnings.some((w) => w.includes('global config is invalid'))).toBe(true)
  })

  it('applies env path/ui/context overrides and tracks env sources', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_LOGS_DIR: '/tmp/logs',
        FORMAX_SUBAGENTS_DIR: '/tmp/subagents',
        FORMAX_PLAN_DIR: '/tmp/plans',
        FORMAX_SHOW_CONTEXT_METER: 'false',
        FORMAX_SHOW_AUTO_COMPACT_NOTICE: '1',
        FORMAX_EFFECTIVE_CONTEXT_WINDOW_PERCENT: '0.8',
        FORMAX_AUTO_COMPACT_TOKEN_LIMIT_PERCENT: '0.7',
        FORMAX_BASELINE_TOKENS: '15000',
        FORMAX_COMPACT_KEEP_LAST_TURNS: '6',
        FORMAX_AUTO_COMPACT_MIN_TURNS_BETWEEN_RUNS: '3',
      },
    })

    expect(res.config.paths.logsDir).toBe('/tmp/logs')
    expect(res.config.paths.subagentsDir).toBe('/tmp/subagents')
    expect(res.config.paths.planDir).toBe('/tmp/plans')
    expect(res.config.ui.showContextMeter).toBe(false)
    expect(res.config.ui.showAutoCompactNotice).toBe(true)
    expect(res.config.context.effectiveContextWindowPercent).toBe(0.8)
    expect(res.config.context.autoCompactTokenLimitPercent).toBe(0.7)
    expect(res.config.context.baselineTokens).toBe(15000)
    expect(res.config.context.compactKeepLastTurns).toBe(6)
    expect(res.config.context.autoCompactMinTurnsBetweenRuns).toBe(3)

    expect(res.sources['paths.logsDir']).toBe('env')
    expect(res.sources['ui.showContextMeter']).toBe('env')
    expect(res.sources['ui.showAutoCompactNotice']).toBe('env')
    expect(res.sources['context.effectiveContextWindowPercent']).toBe('env')
    expect(res.sources['context.autoCompactMinTurnsBetweenRuns']).toBe('env')
  })

  it('applies env paths patch when only subagents dir is provided', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_SUBAGENTS_DIR: '/tmp/agents-only',
      },
    })
    expect(res.config.paths.subagentsDir).toBe('/tmp/agents-only')
    expect(res.config.paths.logsDir).toBeUndefined()
    expect(res.sources['paths.subagentsDir']).toBe('env')
  })

  it('warns and discards env patch when env patch validation fails', () => {
    const originalSafeParse = FormaxConfigV1PatchSchema.safeParse.bind(FormaxConfigV1PatchSchema)
    const safeParseSpy = vi
      .spyOn(FormaxConfigV1PatchSchema, 'safeParse')
      .mockImplementation((input: unknown, ...rest: unknown[]) => {
        if (
          input &&
          typeof input === 'object' &&
          'paths' in input &&
          (input as { paths?: unknown }).paths !== undefined
        ) {
          return {
            success: false,
            error: {} as never,
          } as never
        }
        return originalSafeParse(input, ...(rest as []))
      })

    try {
      const res = resolveRuntimeConfig({
        env: { FORMAX_LOGS_DIR: '/tmp/logs' },
      })

      expect(res.config.paths.logsDir).toBeUndefined()
      expect(res.warnings.some((w) => w.includes('env config is invalid and was ignored'))).toBe(true)
    } finally {
      safeParseSpy.mockRestore()
    }
  })

  it('applies llm context-window and ui text mode from env', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_CONTEXT_WINDOW_TOKENS: '64000',
        FORMAX_ASSISTANT_TEXT_MODE: 'stream',
      },
    })

    expect(res.config.llm.contextWindowTokens).toBe(64000)
    expect(res.config.ui.assistantTextMode).toBe('stream')
    expect(res.sources['llm.contextWindowTokens']).toBe('env')
    expect(res.sources['ui.assistantTextMode']).toBe('env')
  })

  it('applies env ui patch when only one ui field is provided', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_ASSISTANT_TEXT_MODE: 'buffered',
        FORMAX_SHOW_AUTO_COMPACT_NOTICE: '0',
      },
    })

    expect(res.config.ui.assistantTextMode).toBe('buffered')
    expect(res.config.ui.showAutoCompactNotice).toBe(false)
    expect(res.sources['ui.assistantTextMode']).toBe('env')
    expect(res.sources['ui.showAutoCompactNotice']).toBe('env')
  })

  it('applies env ui show-auto-compact without prior ui patch', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_SHOW_AUTO_COMPACT_NOTICE: '0',
      },
    })
    expect(res.config.ui.showAutoCompactNotice).toBe(false)
    expect(res.sources['ui.showAutoCompactNotice']).toBe('env')
  })

  it('warns on invalid env context numeric overrides', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_CONTEXT_WINDOW_TOKENS: '0',
        FORMAX_BASELINE_TOKENS: '-2',
        FORMAX_COMPACT_KEEP_LAST_TURNS: '1.5',
        FORMAX_AUTO_COMPACT_MIN_TURNS_BETWEEN_RUNS: '-1',
      },
    })

    expect(res.config.llm.contextWindowTokens).toBeUndefined()
    expect(res.config.context.baselineTokens).toBe(12000)
    expect(res.config.context.compactKeepLastTurns).toBe(4)
    expect(res.config.context.autoCompactMinTurnsBetweenRuns).toBe(8)
    expect(res.warnings.some((w) => w.includes('FORMAX_CONTEXT_WINDOW_TOKENS'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_BASELINE_TOKENS'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_COMPACT_KEEP_LAST_TURNS'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_AUTO_COMPACT_MIN_TURNS_BETWEEN_RUNS'))).toBe(true)
  })

  it('warns on invalid env booleans and percent overrides', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_SHOW_CONTEXT_METER: 'maybe',
        FORMAX_SHOW_AUTO_COMPACT_NOTICE: '2',
        FORMAX_EFFECTIVE_CONTEXT_WINDOW_PERCENT: '1.1',
        FORMAX_AUTO_COMPACT_TOKEN_LIMIT_PERCENT: '-0.1',
      },
    })

    expect(res.config.ui.showContextMeter).toBe(true)
    expect(res.config.ui.showAutoCompactNotice).toBe(true)
    expect(res.config.context.effectiveContextWindowPercent).toBe(0.95)
    expect(res.config.context.autoCompactTokenLimitPercent).toBe(0.9)
    expect(res.warnings.some((w) => w.includes('FORMAX_SHOW_CONTEXT_METER'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_SHOW_AUTO_COMPACT_NOTICE'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_EFFECTIVE_CONTEXT_WINDOW_PERCENT'))).toBe(true)
    expect(res.warnings.some((w) => w.includes('FORMAX_AUTO_COMPACT_TOKEN_LIMIT_PERCENT'))).toBe(true)
  })

  it('applies FORMAX_SHOW_CONTEXT_METER when set to true', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_SHOW_CONTEXT_METER: 'true',
      },
    })

    expect(res.config.ui.showContextMeter).toBe(true)
    expect(res.sources['ui.showContextMeter']).toBe('env')
  })

  it('applies env context patch when only one context field is valid', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_BASELINE_TOKENS: '2048',
      },
    })

    expect(res.config.context.baselineTokens).toBe(2048)
    expect(res.sources['context.baselineTokens']).toBe('env')
    expect(res.sources['context.compactKeepLastTurns']).toBe('default')
  })

  it('applies env context patch when only compactKeepLastTurns is valid', () => {
    const res = resolveRuntimeConfig({
      env: {
        FORMAX_COMPACT_KEEP_LAST_TURNS: '9',
      },
    })
    expect(res.config.context.compactKeepLastTurns).toBe(9)
    expect(res.config.context.baselineTokens).toBe(12000)
    expect(res.sources['context.compactKeepLastTurns']).toBe('env')
  })

  it('tracks version source when provided in config patch', () => {
    const res = resolveRuntimeConfig({
      defaults: { version: 1, llm: { model: 'default-model' } },
    })

    expect(res.config.version).toBe(1)
    expect(res.config.llm.model).toBe('default-model')
    expect(res.sources.version).toBe('default')
  })
})
