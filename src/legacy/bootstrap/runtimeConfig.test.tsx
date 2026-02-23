import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNodeFileStore = vi.fn(() => ({ kind: 'file-store' }))
const loadRuntimeConfig = vi.fn()
const runLegacySetupWizard = vi.fn(async () => {})

vi.mock('../../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore,
}))
vi.mock('../../env/config.js', () => ({
  loadRuntimeConfig,
}))
vi.mock('../../services/runtimeUiBridge.js', () => ({
  runLegacySetupWizard,
}))

describe('createRuntimeConfigContext', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    runLegacySetupWizard.mockResolvedValue(undefined)
  })

  it('loads config once when api key exists', async () => {
    loadRuntimeConfig.mockResolvedValue({
      llm: { apiKey: 'key' },
    })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env })

    expect(loadRuntimeConfig).toHaveBeenCalledTimes(1)
    expect(runLegacySetupWizard).not.toHaveBeenCalled()
  })

  it('forces setup wizard when forceSetup=true', async () => {
    loadRuntimeConfig
      .mockResolvedValueOnce({ llm: { apiKey: 'key' } })
      .mockResolvedValueOnce({ llm: { apiKey: 'key' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env, forceSetup: true })

    expect(runLegacySetupWizard).toHaveBeenCalledTimes(1)
    expect(loadRuntimeConfig).toHaveBeenCalledTimes(2)
  })

  it('runs setup wizard then reloads config when key is missing', async () => {
    loadRuntimeConfig
      .mockResolvedValueOnce({ llm: { apiKey: '' } })
      .mockResolvedValueOnce({ llm: { apiKey: 'new-key' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await createRuntimeConfigContext({ cwd: '/repo', env: process.env })

    expect(runLegacySetupWizard).toHaveBeenCalledTimes(1)
    expect(loadRuntimeConfig).toHaveBeenCalledTimes(2)
  })

  it('throws when setup wizard is canceled', async () => {
    runLegacySetupWizard.mockRejectedValueOnce(new Error('Setup canceled'))
    loadRuntimeConfig.mockResolvedValue({ llm: { apiKey: '' } })
    const { createRuntimeConfigContext } = await import('./runtimeConfig.js')
    await expect(createRuntimeConfigContext({ cwd: '/repo', env: process.env })).rejects.toThrow('Setup canceled')
  })
})
