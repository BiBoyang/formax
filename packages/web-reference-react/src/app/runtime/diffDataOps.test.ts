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
        if (method === 'bridge/reviewGit/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
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
    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffSummary', {
      source: { kind: 'unstaged' },
      maxFiles: 600,
      cwd: '/repo',
    })
    expect(ctx.setDiffSnapshot).toHaveBeenCalledWith({
      cwd: '/repo',
      source: { kind: 'unstaged' },
      sourceKey: 'git:unstaged',
      generatedAt: '2026-02-15T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0, patch: undefined, untracked: undefined }],
    })
  })

  it('drops summary results that do not match the requested review source', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/unstaged.ts', additions: 1, deletions: 0 }],
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff(undefined, { kind: 'staged' })

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffSummary', {
      source: { kind: 'staged' },
      maxFiles: 600,
      cwd: '/repo',
    })
    expect(ctx.setDiffSnapshot).not.toHaveBeenCalled()
    expect(ctx.setIsRefreshingDiff).toHaveBeenLastCalledWith(false)
  })

  it('keeps loading state balanced when source-aware summary is unavailable', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffSummary') {
          return Promise.reject(new Error('method not found'))
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffSummary', {
      source: { kind: 'unstaged' },
      maxFiles: 600,
      cwd: '/repo',
    })
    expect(ctx.request).toHaveBeenCalledTimes(1)
    expect(ctx.setDiffSnapshot).not.toHaveBeenCalled()
    expect(ctx.setIsRefreshingDiff).toHaveBeenLastCalledWith(false)
  })

  it('does not accept summary results with the git diff error marker', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffSummary') {
          return Promise.resolve({
            cwd: '/repo',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
            generatedAt: '2026-02-15T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'git-diff-error', additions: 0, deletions: 0 }],
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffSummary', {
      source: { kind: 'unstaged' },
      maxFiles: 600,
      cwd: '/repo',
    })
    expect(ctx.request).toHaveBeenCalledTimes(1)
    expect(ctx.setDiffSnapshot).not.toHaveBeenCalled()
  })

  it('requests single file patch via bridge/reviewGit/readDiffFilePatch', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffFilePatch') {
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

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffFilePatch', {
      source: { kind: 'unstaged' },
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

  it('requests image preview via bridge/reviewGit/readDiffFilePreview', async () => {
    const ctx = createBaseContext({
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffFilePreview') {
          return Promise.resolve({
            path: 'images/a.webp',
            found: true,
            preview: {
              kind: 'image',
              mimeType: 'image/webp',
              dataUrl: 'data:image/webp;base64,abc',
              sizeBytes: 3,
            },
          })
        }
        return Promise.resolve({})
      }),
    })
    const ops = createDiffDataOps(ctx)

    const result = await ops.requestDiffFilePreview('images/a.webp')

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffFilePreview', {
      source: { kind: 'unstaged' },
      path: 'images/a.webp',
      maxBytes: 8 * 1024 * 1024,
      cwd: '/repo',
    })
    expect(result).toEqual({
      path: 'images/a.webp',
      found: true,
      preview: {
        kind: 'image',
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,abc',
        sizeBytes: 3,
      },
      error: undefined,
    })
  })

  it('still requests a diff file patch when the current thread has no resolved cwd', async () => {
    const ctx = createBaseContext({
      resolveDiffCwd: vi.fn(() => null),
      request: vi.fn((method: string) => {
        if (method === 'bridge/reviewGit/readDiffFilePatch') {
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

    expect(ctx.request).toHaveBeenCalledWith('bridge/reviewGit/readDiffFilePatch', {
      source: { kind: 'unstaged' },
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
        if (method === 'bridge/reviewGit/readDiffSummary') {
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
