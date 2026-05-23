import { describe, expect, it, vi } from 'vitest'
import { createDiffDataOps, type DiffDataOpsContext } from './diffDataOps'

function createBaseContext(overrides: Partial<DiffDataOpsContext> = {}): DiffDataOpsContext {
  return {
    request: vi.fn(),
    setIsRefreshingDiff: vi.fn(),
    setDiffSnapshot: vi.fn(),
    canRefreshDiff: vi.fn(() => true),
    resolveDiffCwd: vi.fn(() => '/repo'),
    beginDiffRequest: vi.fn(() => 1),
    isCurrentDiffRequest: vi.fn(() => true),
    shouldAcceptDiffResult: vi.fn(() => true),
    ...overrides,
  }
}

describe('diffDataOps', () => {
  it('refreshes workspace diff with loading state transitions', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.setIsRefreshingDiff).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsRefreshingDiff).toHaveBeenLastCalledWith(false)
    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiffSummary', { maxFiles: 600, cwd: '/repo' })
    expect(ctx.setDiffSnapshot).toHaveBeenCalledWith({
      cwd: '/repo',
      generatedAt: '2026-02-15T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0, patch: undefined, untracked: undefined }],
    })
  })

  it('falls back to bridge/readDiff when summary method is unavailable', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffSummary') {
          return Promise.reject(new Error('method not found'))
        }
        if (method === 'bridge/readDiff') {
          return Promise.resolve({
            cwd: '/repo',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/b.ts', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' }],
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiffSummary', { maxFiles: 600, cwd: '/repo' })
    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiff', { maxBytes: 180 * 1024, cwd: '/repo' })
    expect(ctx.setDiffSnapshot).toHaveBeenCalledWith({
      cwd: '/repo',
      generatedAt: '2026-02-15T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [{ path: 'src/b.ts', additions: 2, deletions: 1, patch: '@@ -1 +1 @@', untracked: undefined }],
    })
  })

  it('falls back to bridge/readDiff when summary reports git diff error marker', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'git-diff-error', additions: 0, deletions: 0 }],
          })
        }
        if (method === 'bridge/readDiff') {
          return Promise.resolve({
            cwd: '/repo',
            generatedAt: '2026-02-15T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/fallback.ts', additions: 1, deletions: 1, patch: '@@ -1 +1 @@' }],
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiffSummary', { maxFiles: 600, cwd: '/repo' })
    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiff', { maxBytes: 180 * 1024, cwd: '/repo' })
    expect(ctx.setDiffSnapshot).toHaveBeenCalledWith({
      cwd: '/repo',
      generatedAt: '2026-02-15T00:00:01.000Z',
      hasChanges: true,
      truncated: false,
      files: [{ path: 'src/fallback.ts', additions: 1, deletions: 1, patch: '@@ -1 +1 @@', untracked: undefined }],
    })
  })

  it('requests single file patch via bridge/readDiffFilePatch', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffFilePatch') {
          return Promise.resolve({
            path: 'src/a.ts',
            found: true,
            truncated: false,
            file: {
              path: 'src/a.ts',
              additions: 3,
              deletions: 1,
              patch: '@@ -1 +1 @@',
            },
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    const result = await ops.requestDiffFilePatch('src/a.ts')

    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiffFilePatch', {
      path: 'src/a.ts',
      maxBytes: 220 * 1024,
      cwd: '/repo',
    })
    expect(result).toEqual({
      path: 'src/a.ts',
      found: true,
      truncated: false,
      patch: '@@ -1 +1 @@',
      additions: 3,
      deletions: 1,
      untracked: undefined,
    })
  })

  it('still requests a diff file patch when the current thread has no resolved cwd', async () => {
    const ctx = createBaseContext({
      resolveDiffCwd: vi.fn(() => null),
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffFilePatch') {
          return Promise.resolve({
            path: 'src/a.ts',
            found: true,
            truncated: false,
            file: {
              path: 'src/a.ts',
              additions: 3,
              deletions: 1,
              patch: '@@ -1 +1 @@',
            },
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    const result = await ops.requestDiffFilePatch('src/a.ts')

    expect(ctx.request).toHaveBeenCalledWith('bridge/readDiffFilePatch', {
      path: 'src/a.ts',
      maxBytes: 220 * 1024,
    })
    expect(result?.path).toBe('src/a.ts')
  })

  it('skips diff requests entirely when no thread surface owns diff state', async () => {
    const ctx = createBaseContext({
      canRefreshDiff: vi.fn(() => false),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()
    const patchResult = await ops.requestDiffFilePatch('src/a.ts')

    expect(ctx.request).not.toHaveBeenCalled()
    expect(ctx.setIsRefreshingDiff).not.toHaveBeenCalled()
    expect(ctx.setDiffSnapshot).not.toHaveBeenCalled()
    expect(patchResult).toBeNull()
  })

  it('drops late diff results when request ownership has been invalidated', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
          })
        }
        return Promise.resolve({})
      }),
      beginDiffRequest: vi.fn(() => 7),
      isCurrentDiffRequest: vi.fn(() => false),
      shouldAcceptDiffResult: vi.fn(() => false),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.setDiffSnapshot).not.toHaveBeenCalled()
    expect(ctx.setIsRefreshingDiff).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsRefreshingDiff).toHaveBeenCalledTimes(1)
    expect(ctx.request).toHaveBeenCalledTimes(1)
  })
})
