import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRuntimeConfig: vi.fn(),
  createNodeFileStore: vi.fn(),
  loadConfigFiles: vi.fn(),
  getConfigPaths: vi.fn(),
  resolveActiveModel: vi.fn(),
}))

vi.mock('../config/settings/resolve.js', () => ({
  resolveRuntimeConfig: mocks.resolveRuntimeConfig,
}))
vi.mock('./nodeFileStore.js', () => ({
  createNodeFileStore: mocks.createNodeFileStore,
}))
vi.mock('./configFiles.js', () => ({
  loadConfigFiles: mocks.loadConfigFiles,
}))
vi.mock('./configPaths.js', () => ({
  getConfigPaths: mocks.getConfigPaths,
}))
vi.mock('./modelTier.js', () => ({
  resolveActiveModel: mocks.resolveActiveModel,
}))

import { loadRuntimeConfig } from './config'

function createResolvedConfig(overrides: Partial<any> = {}): any {
  const { config: _ignoredConfig, ...restOverrides } = overrides
  const overrideConfig = overrides.config ?? {}
  const overrideLlm = overrideConfig.llm ?? {}
  const overridePaths = overrideConfig.paths ?? {}
  const overrideContext = overrideConfig.context ?? {}
  const overrideUi = overrideConfig.ui ?? {}

  return {
    config: {
      llm: {
        provider: 'anthropic',
        baseUrl: ' https://api.anthropic.com/v1/ ',
        model: 'configured-sonnet',
        defaultTier: 'sonnet',
        tierModels: undefined,
        tierContextWindowTokens: undefined,
        timeoutMs: 5000,
        contextWindowTokens: undefined,
        thinkingMode: true,
        ...overrideLlm,
      },
      paths: {
        logsDir: '',
        subagentsDir: '',
        planDir: '',
        ...overridePaths,
      },
      context: {
        effectiveContextWindowPercent: 0.95,
        autoCompactTokenLimitPercent: 0.9,
        baselineTokens: 12000,
        compactKeepLastTurns: 4,
        enableAutoCompact: true,
        autoCompactMinTurnsBetweenRuns: 8,
        ...overrideContext,
      },
      ui: {
        assistantTextMode: 'buffered',
        showContextMeter: true,
        showAutoCompactNotice: true,
        outputStyle: 'default',
        verboseOutput: false,
        ...overrideUi,
      },
    },
    auth: {
      apiKey: 'sk-test',
    },
    ...restOverrides,
  }
}

describe('loadRuntimeConfig branch coverage', () => {
  beforeEach(() => {
    mocks.createNodeFileStore.mockReturnValue({ kind: 'store' })
    mocks.loadConfigFiles.mockResolvedValue({
      globalConfig: { version: 1 },
      projectConfig: { version: 1 },
      authStore: { version: 1 },
    })
    mocks.getConfigPaths.mockReturnValue({
      globalConfigDir: '.formax-global',
      projectConfigDir: '.formax',
    })
    mocks.resolveActiveModel.mockReturnValue({
      defaultTier: 'sonnet',
      model: 'resolved-model',
    })
    mocks.resolveRuntimeConfig.mockReturnValue(createResolvedConfig())
  })

  it('uses explicit path overrides and includes optional llm fields when present', async () => {
    mocks.resolveActiveModel.mockReturnValueOnce({
      defaultTier: 'opus',
      model: 'resolved-model',
    })
    mocks.resolveRuntimeConfig.mockReturnValue(
      createResolvedConfig({
        config: {
          llm: {
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1/',
            model: 'configured-sonnet',
            defaultTier: 'opus',
            tierModels: {
              haiku: 'h',
              sonnet: 's',
              opus: 'o',
            },
            tierContextWindowTokens: {
              haiku: 64000,
              sonnet: 128000,
              opus: 256000,
            },
            timeoutMs: 7000,
            contextWindowTokens: 32000,
            thinkingMode: false,
          },
          paths: {
            logsDir: './custom-logs',
            subagentsDir: './custom-agents',
            planDir: './custom-plans',
          },
        },
      }),
    )
    const cwd = '/repo'

    const cfg = await loadRuntimeConfig({} as any, cwd)

    expect(cfg.paths.logsDir).toBe('/repo/custom-logs')
    expect(cfg.paths.subagentsDir).toBe('/repo/custom-agents')
    expect(cfg.paths.planDir).toBe('/repo/custom-plans')
    expect(cfg.llm.tierModels).toEqual({ haiku: 'h', sonnet: 's', opus: 'o' })
    expect(cfg.llm.tierContextWindowTokens).toEqual({ haiku: 64000, sonnet: 128000, opus: 256000 })
    expect(cfg.llm.contextWindowTokens).toBe(256000)
    expect(cfg.llm.baseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('prefers FORMAX_CONTEXT_WINDOW_TOKENS over tier context mapping', async () => {
    mocks.resolveActiveModel.mockReturnValueOnce({
      defaultTier: 'opus',
      model: 'resolved-model',
    })
    mocks.resolveRuntimeConfig.mockReturnValue(
      createResolvedConfig({
        config: {
          llm: {
            tierContextWindowTokens: {
              haiku: 64000,
              sonnet: 128000,
              opus: 256000,
            },
            contextWindowTokens: 32000,
          },
        },
      }),
    )

    const cfg = await loadRuntimeConfig({ FORMAX_CONTEXT_WINDOW_TOKENS: '64000' } as any, '/repo')
    expect(cfg.llm.contextWindowTokens).toBe(64000)
  })

  it('falls back timeout to 600000 when resolved timeout is falsy', async () => {
    mocks.resolveRuntimeConfig.mockReturnValue(
      createResolvedConfig({
        config: {
          llm: {
            provider: 'anthropic',
            baseUrl: '',
            model: '',
            defaultTier: 'sonnet',
            tierModels: undefined,
            timeoutMs: 0,
            contextWindowTokens: undefined,
            thinkingMode: true,
          },
        },
      }),
    )

    const cfg = await loadRuntimeConfig({} as any, '/repo')
    expect(cfg.llm.timeoutMs).toBe(600000)
  })
})
