import { describe, expect, it, vi } from 'vitest'
import { createDiffUiHandlers } from './diffUiHandlers'

describe('diffUiHandlers', () => {
  it('routes refresh via runAsyncSafely and forwards patch requests', async () => {
    const refreshPromise = Promise.resolve()
    const patchPayload = {
      path: 'src/a.ts',
      found: true,
      truncated: false,
      patch: '@@ -1 +1 @@',
      additions: 1,
      deletions: 0,
      untracked: undefined,
    }
    const previewPayload = {
      path: 'images/a.webp',
      found: true,
      preview: {
        kind: 'image' as const,
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,abc',
        sizeBytes: 3,
      },
    }
    const refreshWorkspaceDiff = vi.fn(() => refreshPromise)
    const requestDiffFilePatch = vi.fn(async () => patchPayload)
    const requestDiffFilePreview = vi.fn(async () => previewPayload)
    const runAsyncSafely = vi.fn()
    const handlers = createDiffUiHandlers({
      refreshWorkspaceDiff,
      requestDiffFilePatch,
      requestDiffFilePreview,
      runAsyncSafely,
    })

    handlers.onRefreshDiff()
    const result = await handlers.onRequestDiffPatch('src/a.ts')
    const previewResult = await handlers.onRequestDiffPreview('images/a.webp')

    expect(refreshWorkspaceDiff).toHaveBeenCalledWith(undefined, undefined)
    expect(runAsyncSafely).toHaveBeenCalledWith(refreshPromise)
    expect(requestDiffFilePatch).toHaveBeenCalledWith('src/a.ts', undefined, undefined)
    expect(result).toEqual(patchPayload)
    expect(requestDiffFilePreview).toHaveBeenCalledWith('images/a.webp', undefined, undefined)
    expect(previewResult).toEqual(previewPayload)
  })
})
