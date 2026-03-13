import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfigPaths: vi.fn(),
  createNodeFileStore: vi.fn(),
  detectWorkspaceRoots: vi.fn(),
  updateConfigPatchFile: vi.fn(),
  getKnownContextWindowTokens: vi.fn(),
  loadRuntimeConfig: vi.fn(),
}))

vi.mock('../../adapters/fs/configPaths', () => ({
  getConfigPaths: mocks.getConfigPaths,
}))
vi.mock('../../adapters/fs/nodeFileStore', () => ({
  createNodeFileStore: mocks.createNodeFileStore,
}))
vi.mock('../../adapters/fs/workspaceRoots', () => ({
  detectWorkspaceRoots: mocks.detectWorkspaceRoots,
}))
vi.mock('../../chat/context/modelWindow', () => ({
  getKnownContextWindowTokens: mocks.getKnownContextWindowTokens,
}))
vi.mock('../../config/config', () => ({
  loadRuntimeConfig: mocks.loadRuntimeConfig,
}))
vi.mock('../../config/settings/persist', () => ({
  updateConfigPatchFile: mocks.updateConfigPatchFile,
}))

import { loadWorkspaceRoots, persistDefaultModelTier, resolveUserAgentsDir } from './replEnvironmentService.js'

describe('replEnvironmentService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.createNodeFileStore.mockReturnValue({ kind: 'store' })
    mocks.getConfigPaths.mockReturnValue({
      globalConfigDir: '.formax',
      globalConfigPath: '/repo/.formax/config.json',
    })
    mocks.loadRuntimeConfig.mockResolvedValue({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'm-sonnet',
        defaultTier: 'sonnet',
        contextWindowTokens: undefined,
        tierContextWindowTokens: undefined,
      },
    })
    mocks.getKnownContextWindowTokens.mockReturnValue(180000)
  })

  it('resolveUserAgentsDir builds agents directory from resolved global config dir', () => {
    const out = resolveUserAgentsDir({
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
    })

    expect(mocks.getConfigPaths).toHaveBeenCalledWith({
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
    })
    expect(out).toBe('/repo/.formax/agents')
  })

  it('resolveUserAgentsDir uses process defaults when args are omitted', () => {
    const out = resolveUserAgentsDir()
    expect(mocks.getConfigPaths).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
    })
    expect(out).toBe(`${process.cwd()}/.formax/agents`)
  })

  it('persistDefaultModelTier writes llm.defaultTier and syncs llm.contextWindowTokens', async () => {
    await persistDefaultModelTier({
      nextTier: 'sonnet',
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
    })

    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(1, {
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: { llm: { defaultTier: 'sonnet' } },
      label: 'llm.defaultTier',
    })
    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(2, {
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: {
        llm: {
          contextWindowTokens: 180000,
          tierContextWindowTokens: { haiku: 32768, sonnet: 180000, opus: 32768 },
        },
      },
      label: 'llm.contextWindowTokens/llm.tierContextWindowTokens',
    })
  })

  it('persistDefaultModelTier defaults cwd/env to process values', async () => {
    await persistDefaultModelTier({ nextTier: 'haiku' })

    expect(mocks.getConfigPaths).toHaveBeenCalledWith({
      cwd: process.cwd(),
      env: process.env,
    })
    expect(mocks.updateConfigPatchFile).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPatch: { llm: { defaultTier: 'haiku' } },
      }),
    )
  })

  it('falls back to known model window when tier context window is missing', async () => {
    mocks.loadRuntimeConfig.mockResolvedValueOnce({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'm-opus',
        defaultTier: 'opus',
        contextWindowTokens: undefined,
        tierContextWindowTokens: undefined,
      },
    })
    mocks.getKnownContextWindowTokens.mockReturnValueOnce(200000)

    await persistDefaultModelTier({ nextTier: 'opus', cwd: '/repo', env: { FORMAX_CONFIG_DIR: '/cfg' } })

    expect(mocks.updateConfigPatchFile).toHaveBeenLastCalledWith({
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: {
        llm: {
          contextWindowTokens: 200000,
          tierContextWindowTokens: { haiku: 32768, sonnet: 32768, opus: 200000 },
        },
      },
      label: 'llm.contextWindowTokens/llm.tierContextWindowTokens',
    })
  })

  it('prefers stored tier context window over known model map', async () => {
    mocks.loadRuntimeConfig.mockResolvedValueOnce({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'm-sonnet',
        defaultTier: 'sonnet',
        contextWindowTokens: 64000,
        tierContextWindowTokens: { haiku: 70000, sonnet: 180000, opus: 64000 },
      },
    })
    mocks.getKnownContextWindowTokens.mockReturnValueOnce(200000)

    await persistDefaultModelTier({ nextTier: 'sonnet', cwd: '/repo', env: { FORMAX_CONFIG_DIR: '/cfg' } })

    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(2, {
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: {
        llm: {
          contextWindowTokens: 180000,
          tierContextWindowTokens: { haiku: 70000, sonnet: 180000, opus: 64000 },
        },
      },
      label: 'llm.contextWindowTokens/llm.tierContextWindowTokens',
    })
  })

  it('does not rewrite context window when detection matches current value', async () => {
    mocks.loadRuntimeConfig.mockResolvedValueOnce({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'm-sonnet',
        defaultTier: 'haiku',
        contextWindowTokens: 180000,
        tierContextWindowTokens: { haiku: 180000, sonnet: 32768, opus: 32768 },
      },
    })

    await persistDefaultModelTier({ nextTier: 'haiku', cwd: '/repo', env: { FORMAX_CONFIG_DIR: '/cfg' } })

    expect(mocks.updateConfigPatchFile).toHaveBeenCalledTimes(1)
    expect(mocks.updateConfigPatchFile).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPatch: { llm: { defaultTier: 'haiku' } },
      }),
    )
  })

  it('syncs context windows against effective tier when project override wins', async () => {
    mocks.loadRuntimeConfig.mockResolvedValueOnce({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'm-opus',
        defaultTier: 'opus',
        contextWindowTokens: undefined,
        tierContextWindowTokens: undefined,
      },
    })
    mocks.getKnownContextWindowTokens.mockReturnValueOnce(220000)

    await persistDefaultModelTier({ nextTier: 'haiku', cwd: '/repo', env: { FORMAX_CONFIG_DIR: '/cfg' } })

    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(2, {
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: {
        llm: {
          contextWindowTokens: 220000,
          tierContextWindowTokens: { haiku: 32768, sonnet: 32768, opus: 220000 },
        },
      },
      label: 'llm.contextWindowTokens/llm.tierContextWindowTokens',
    })
  })

  it('does not persist env-only context window fallback when metadata is missing', async () => {
    mocks.loadRuntimeConfig.mockResolvedValueOnce({
      llm: {
        provider: 'anthropic',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        model: 'unknown-model',
        defaultTier: 'haiku',
        contextWindowTokens: 50000,
        tierContextWindowTokens: undefined,
      },
    })
    mocks.getKnownContextWindowTokens.mockReturnValueOnce(undefined)

    await persistDefaultModelTier({
      nextTier: 'haiku',
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg', FORMAX_CONTEXT_WINDOW_TOKENS: '50000' },
    })

    expect(mocks.updateConfigPatchFile).toHaveBeenCalledTimes(1)
    expect(mocks.updateConfigPatchFile).toHaveBeenCalledWith(
      expect.objectContaining({
        nextPatch: { llm: { defaultTier: 'haiku' } },
      }),
    )
  })

  it('loadWorkspaceRoots delegates to detectWorkspaceRoots with node file store', async () => {
    mocks.detectWorkspaceRoots.mockResolvedValueOnce({ roots: ['/repo'] })

    const out = await loadWorkspaceRoots({ cwd: '/repo' })

    expect(mocks.detectWorkspaceRoots).toHaveBeenCalledWith({
      fileStore: { kind: 'store' },
      cwd: '/repo',
    })
    expect(out).toEqual({ roots: ['/repo'] })
  })

  it('loadWorkspaceRoots defaults cwd to process.cwd()', async () => {
    mocks.detectWorkspaceRoots.mockResolvedValueOnce({ roots: [] })
    await loadWorkspaceRoots()

    expect(mocks.detectWorkspaceRoots).toHaveBeenCalledWith({
      fileStore: { kind: 'store' },
      cwd: process.cwd(),
    })
  })
})
