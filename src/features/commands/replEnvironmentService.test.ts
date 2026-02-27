import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfigPaths: vi.fn(),
  createNodeFileStore: vi.fn(),
  detectWorkspaceRoots: vi.fn(),
  updateConfigPatchFile: vi.fn(),
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
vi.mock('../../core/config/persist', () => ({
  updateConfigPatchFile: mocks.updateConfigPatchFile,
}))

import { loadWorkspaceRoots, persistDefaultModelTier, resolveUserAgentsDir } from './replEnvironmentService.js'

describe('replEnvironmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createNodeFileStore.mockReturnValue({ kind: 'store' })
    mocks.getConfigPaths.mockReturnValue({
      globalConfigDir: '.formax',
      globalConfigPath: '/repo/.formax/config.json',
    })
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

  it('persistDefaultModelTier writes llm.defaultTier patch to global config file', async () => {
    await persistDefaultModelTier({
      nextTier: 'sonnet',
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
    })

    expect(mocks.updateConfigPatchFile).toHaveBeenCalledWith({
      fileStore: { kind: 'store' },
      filePath: '/repo/.formax/config.json',
      nextPatch: { llm: { defaultTier: 'sonnet' } },
      label: 'llm.defaultTier',
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
