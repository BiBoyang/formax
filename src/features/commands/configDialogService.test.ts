import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfigFiles: vi.fn(),
  getConfigPaths: vi.fn(),
  createNodeFileStore: vi.fn(),
  updateConfigPatchFile: vi.fn(),
  resolveRuntimeConfig: vi.fn(),
}))

vi.mock('../../adapters/fs/configFiles.js', () => ({
  loadConfigFiles: mocks.loadConfigFiles,
}))
vi.mock('../../adapters/fs/configPaths.js', () => ({
  getConfigPaths: mocks.getConfigPaths,
}))
vi.mock('../../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore: mocks.createNodeFileStore,
}))
vi.mock('../../config/settings/persist.js', () => ({
  updateConfigPatchFile: mocks.updateConfigPatchFile,
}))
vi.mock('../../config/settings/resolve.js', () => ({
  resolveRuntimeConfig: mocks.resolveRuntimeConfig,
}))

import { createConfigDialogService } from './configDialogService'

describe('configDialogService', () => {
  beforeEach(() => {
    mocks.loadConfigFiles.mockReset()
    mocks.getConfigPaths.mockReset()
    mocks.createNodeFileStore.mockReset()
    mocks.updateConfigPatchFile.mockReset()
    mocks.resolveRuntimeConfig.mockReset()

    mocks.createNodeFileStore.mockReturnValue({ kind: 'store' })
    mocks.loadConfigFiles.mockResolvedValue({
      globalConfig: { version: 1 },
      projectConfig: { version: 1 },
      authStore: { version: 1 },
    })
    mocks.resolveRuntimeConfig.mockReturnValue({
      config: {
        ui: {
          outputStyle: 'learning',
          verboseOutput: true,
        },
        llm: {
          thinkingMode: false,
        },
      },
      sources: {
        'ui.outputStyle': 'project',
        'llm.thinkingMode': 'env',
        'ui.verboseOutput': 'flags',
      },
    })
    mocks.getConfigPaths.mockReturnValue({
      globalConfigPath: '/cfg/global/config.json',
      projectConfigPath: '/repo/.formax/config.json',
    })
    mocks.updateConfigPatchFile.mockResolvedValue(undefined)
  })

  it('loads values and maps source labels', async () => {
    const service = createConfigDialogService({
      fileStore: { kind: 'store' } as any,
      cwd: '/repo',
      env: { A: '1' } as any,
    })
    const snapshot = await service.load()

    expect(snapshot).toEqual({
      values: {
        outputStyle: 'learning',
        thinkingMode: false,
        verboseOutput: true,
      },
      sources: {
        outputStyle: 'Project',
        thinkingMode: 'Env',
        verboseOutput: 'Flags',
      },
    })
  })

  it('falls back source labels to Default for unknown/missing source', async () => {
    mocks.resolveRuntimeConfig.mockReturnValueOnce({
      config: {
        ui: { outputStyle: 'default', verboseOutput: false },
        llm: { thinkingMode: true },
      },
      sources: {
        'ui.outputStyle': 'global',
        'llm.thinkingMode': 'default',
      },
    })
    const service = createConfigDialogService({
      fileStore: { kind: 'store' } as any,
      cwd: '/repo',
      env: {} as any,
    })
    const snapshot = await service.load()
    expect(snapshot.sources).toEqual({
      outputStyle: 'User',
      thinkingMode: 'Default',
      verboseOutput: 'Default',
    })
  })

  it('persists outputStyle to project config and validates value via schema', async () => {
    const service = createConfigDialogService({
      fileStore: { kind: 'store' } as any,
      cwd: '/repo',
      env: {} as any,
    })
    await service.persist({ id: 'outputStyle', value: 'explanatory' })
    await service.persist({ id: 'outputStyle', value: 'not-valid' })

    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filePath: '/repo/.formax/config.json',
        label: 'outputStyle',
        nextPatch: { ui: { outputStyle: 'explanatory' } },
      }),
    )
    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filePath: '/repo/.formax/config.json',
        nextPatch: { ui: { outputStyle: 'default' } },
      }),
    )
  })

  it('persists thinkingMode and verboseOutput to global config with boolean coercion', async () => {
    const service = createConfigDialogService({
      fileStore: { kind: 'store' } as any,
      cwd: '/repo',
      env: {} as any,
    })
    await service.persist({ id: 'thinkingMode', value: 1 })
    await service.persist({ id: 'verboseOutput', value: 0 })

    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filePath: '/cfg/global/config.json',
        label: 'thinkingMode',
        nextPatch: { llm: { thinkingMode: true } },
      }),
    )
    expect(mocks.updateConfigPatchFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filePath: '/cfg/global/config.json',
        label: 'verboseOutput',
        nextPatch: { ui: { verboseOutput: false } },
      }),
    )
  })

  it('uses default fileStore/cwd/env when args are omitted', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/cwd-default')
    const prevEnv = process.env
    process.env = { ...prevEnv, FORMAX_X: '1' } as any
    try {
      const service = createConfigDialogService()
      await service.load()
      await service.persist({ id: 'thinkingMode', value: true })

      expect(mocks.loadConfigFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          fileStore: { kind: 'store' },
          cwd: '/cwd-default',
        }),
      )
      expect(mocks.getConfigPaths).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/cwd-default',
        }),
      )
    } finally {
      process.env = prevEnv
      cwdSpy.mockRestore()
    }
  })
})
