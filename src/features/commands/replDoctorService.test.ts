import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '../../env/config.js'

const {
  checkWritableDir,
  createNodeFileStore,
  testSetupConnection,
  configShow,
  runDoctor,
  formatDoctorHuman,
  getConfigPaths,
} = vi.hoisted(() => ({
  checkWritableDir: vi.fn(),
  createNodeFileStore: vi.fn(),
  testSetupConnection: vi.fn(),
  configShow: vi.fn(),
  runDoctor: vi.fn(),
  formatDoctorHuman: vi.fn(),
  getConfigPaths: vi.fn(),
}))

vi.mock('../../adapters/fs/checkWritableDir.js', () => ({
  checkWritableDir,
}))
vi.mock('../../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore,
}))
vi.mock('../../adapters/setup/connectionTest.js', () => ({
  testSetupConnection,
}))
vi.mock('../../core/config/show.js', () => ({
  configShow,
}))
vi.mock('../../core/diagnostics/doctor.js', () => ({
  runDoctor,
}))
vi.mock('../../core/diagnostics/format.js', () => ({
  formatDoctorHuman,
}))
vi.mock('../../config/configPaths.js', () => ({
  getConfigPaths,
}))

import { runReplDoctor } from './replDoctorService.js'

function makeRuntimeConfig(): RuntimeConfig {
  return {
    llm: {
      provider: 'openai',
      apiKey: 'runtime-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      timeoutMs: 30_000,
      thinkingMode: false,
      contextWindowTokens: null,
    },
    paths: {
      configDir: '/cfg',
      globalConfigDir: '/cfg',
      projectConfigDir: '/repo/.formax',
      historyDir: '/cfg/history',
      logsDir: '/cfg/logs',
      planDir: '/cfg/plans',
      subagentsDir: '/cfg/subagents',
      commandDir: '/cfg/commands',
      hooksDir: '/cfg/hooks',
    },
    auth: {
      method: 'apikey',
      useCodexAuth: false,
    },
    model: {
      defaultModel: '',
      baselineModels: [],
    },
    context: {
      effectiveContextWindowPercent: 0.8,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 0,
    },
    execution: {
      maxOutputChars: 12_000,
    },
  }
}

describe('runReplDoctor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createNodeFileStore.mockReturnValue({ kind: 'store' })
    getConfigPaths.mockReturnValue({ config: 'paths' })
    configShow.mockResolvedValue({
      config: { llm: { provider: 'anthropic' } },
      paths: { resolved: true },
      files: { project: null, global: '/cfg/config.json' },
      warnings: ['w1'],
    })
    runDoctor.mockResolvedValue({
      version: '1.2.3',
      cwd: '/repo',
      checks: [{ id: 'ok', ok: true }],
      warnings: ['warn'],
    })
    formatDoctorHuman.mockReturnValue('doctor output')
  })

  it('wires runtime/config dependencies and appends trailing newline', async () => {
    const out = await runReplDoctor({
      version: '1.2.3',
      cfg: makeRuntimeConfig(),
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
    })

    expect(out).toBe('doctor output\n')
    expect(createNodeFileStore).toHaveBeenCalledTimes(1)
    expect(getConfigPaths).toHaveBeenCalledWith({
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
      platform: process.platform,
    })
    expect(configShow).toHaveBeenCalledWith({
      fileStore: { kind: 'store' },
      paths: { config: 'paths' },
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
      platform: process.platform,
    })
    expect(runDoctor).toHaveBeenCalledWith({
      version: '1.2.3',
      cwd: '/repo',
      provider: 'anthropic',
      runtime: {
        llm: {
          apiKey: 'runtime-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
        paths: makeRuntimeConfig().paths,
      },
      config: {
        paths: { resolved: true },
        files: { project: null, global: '/cfg/config.json' },
      },
      warnings: ['w1'],
      testConnection: testSetupConnection,
      checkWritableDir,
    })
    expect(formatDoctorHuman).toHaveBeenCalledWith({
      version: '1.2.3',
      cwd: '/repo',
      checks: [{ id: 'ok', ok: true }],
      warnings: ['warn'],
    })
  })

  it('uses process cwd/env defaults when optional args are omitted', async () => {
    await runReplDoctor({
      version: '2.0.0',
      cfg: makeRuntimeConfig(),
    })

    expect(getConfigPaths).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
      platform: process.platform,
    })
  })
})
