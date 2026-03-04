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
    const refreshWorkspaceDiff = vi.fn(() => refreshPromise)
    const requestDiffFilePatch = vi.fn(async () => patchPayload)
    const runAsyncSafely = vi.fn()
    const handlers = createDiffUiHandlers({
      refreshWorkspaceDiff,
      requestDiffFilePatch,
      runAsyncSafely,
    })

    handlers.onRefreshDiff()
    const result = await handlers.onRequestDiffPatch('src/a.ts')

    expect(refreshWorkspaceDiff).toHaveBeenCalledWith()
    expect(runAsyncSafely).toHaveBeenCalledWith(refreshPromise)
    expect(requestDiffFilePatch).toHaveBeenCalledWith('src/a.ts')
    expect(result).toEqual(patchPayload)
  })
})
