import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createNodeFileStore: vi.fn(),
  loadMergedPermissions: vi.fn(),
  persistPermissionRule: vi.fn(),
  deletePermissionRule: vi.fn(),
  persistWorkspaceDirectory: vi.fn(),
  deleteWorkspaceDirectory: vi.fn(),
}))

vi.mock('../../adapters/fs/nodeFileStore.js', () => ({
  createNodeFileStore: mocks.createNodeFileStore,
}))

vi.mock('../../adapters/permissions/permissionsStore.js', () => ({
  loadMergedPermissions: mocks.loadMergedPermissions,
  persistPermissionRule: mocks.persistPermissionRule,
  deletePermissionRule: mocks.deletePermissionRule,
  persistWorkspaceDirectory: mocks.persistWorkspaceDirectory,
  deleteWorkspaceDirectory: mocks.deleteWorkspaceDirectory,
}))

import { createPermissionsDialogService } from './permissionsDialogService'

describe('createPermissionsDialogService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createNodeFileStore.mockReturnValue({ kind: 'store' })
  })

  it('forwards explicit args to permissions store adapters', async () => {
    const fileStore = { kind: 'explicit-store' } as any
    const service = createPermissionsDialogService({
      fileStore,
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' } as any,
      platform: 'linux',
      homedir: '/home/user',
    })

    await service.load()
    await service.persistRule({ scope: 'project', kind: 'allow', rule: 'Read:*' })
    await service.deleteRule({ scope: 'project', kind: 'allow', rule: 'Read:*' })
    await service.persistWorkspaceDir({ scope: 'project', dir: '/repo' })
    await service.deleteWorkspaceDir({ scope: 'project', dir: '/repo' })

    expect(mocks.loadMergedPermissions).toHaveBeenCalledWith({
      fileStore,
      cwd: '/repo',
      env: { FORMAX_CONFIG_DIR: '/cfg' },
      platform: 'linux',
      homedir: '/home/user',
    })
    expect(mocks.persistPermissionRule).toHaveBeenCalledWith(
      expect.objectContaining({ fileStore, cwd: '/repo', scope: 'project', kind: 'allow', rule: 'Read:*' }),
    )
    expect(mocks.deletePermissionRule).toHaveBeenCalledWith(
      expect.objectContaining({ fileStore, cwd: '/repo', scope: 'project', kind: 'allow', rule: 'Read:*' }),
    )
    expect(mocks.persistWorkspaceDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ fileStore, cwd: '/repo', scope: 'project', dir: '/repo' }),
    )
    expect(mocks.deleteWorkspaceDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ fileStore, cwd: '/repo', scope: 'project', dir: '/repo' }),
    )
  })

  it('defaults fileStore/cwd/env from process context', async () => {
    const service = createPermissionsDialogService()
    await service.load()

    expect(mocks.createNodeFileStore).toHaveBeenCalledTimes(1)
    expect(mocks.loadMergedPermissions).toHaveBeenCalledWith({
      fileStore: { kind: 'store' },
      cwd: process.cwd(),
      env: process.env,
      platform: undefined,
      homedir: undefined,
    })
  })
})
