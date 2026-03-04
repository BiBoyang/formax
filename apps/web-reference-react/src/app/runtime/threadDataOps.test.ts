import { describe, expect, it, vi } from 'vitest'
import { createThreadDataOps, type ThreadDataOpsContext } from './threadDataOps'

vi.mock('../../eventAdapters', () => ({
  mapThreadHistoryToCanonicalLogs: vi.fn(() => [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }]),
}))

vi.mock('../core/rpcContracts', () => ({
  parseResolvedInputsResponse: vi.fn(() => []),
  parseThreadMessagesResponse: vi.fn(() => ({ data: [], nextCursor: 'cursor-next' })),
  parseThreadListResponse: vi.fn(() => []),
}))

function createBaseContext(overrides: Partial<ThreadDataOpsContext> = {}): ThreadDataOpsContext {
  let historyLoadingByThread: Record<string, boolean> = {}
  let historyCursorByThread: Record<string, string | null> = {}
  let transcriptSourceByThread: Record<string, 'history' | 'replay'> = {}
  let logsByThread: Record<string, any[]> = {}
  const historyCursorByThreadIdRef = { current: {} as Record<string, string | null> }
  const logsByThreadIdRef = { current: {} as Record<string, any[]> }

  return {
    request: vi.fn(),
    dispatch: vi.fn(),
    log: vi.fn(),
    activeThreadIdRef: { current: 'thread-1' },
    historyLoadTokenRef: { current: 0 },
    historyLoadSeqByThreadRef: { current: {} },
    historyLoadingRef: { current: {} },
    historyCursorByThreadIdRef,
    transcriptSourceByThreadRef: { current: {} },
    logsByThreadIdRef,
    stateLogsRef: { current: [] },
    seenStaleInputIdRef: { current: new Set<string>() },
    setIsRefreshingDiff: vi.fn(),
    setDiffSnapshot: vi.fn(),
    setHistoryLoadingByThreadId: vi.fn((updater) => {
      historyLoadingByThread = updater(historyLoadingByThread)
      return historyLoadingByThread
    }),
    setHistoryCursorByThreadId: vi.fn((updater) => {
      historyCursorByThread = updater(historyCursorByThread)
      historyCursorByThreadIdRef.current = historyCursorByThread
      return historyCursorByThread
    }),
    setTranscriptSourceByThreadId: vi.fn((updater) => {
      transcriptSourceByThread = updater(transcriptSourceByThread)
      return transcriptSourceByThread
    }),
    setLogsByThreadId: vi.fn((updater) => {
      logsByThread = updater(logsByThread)
      logsByThreadIdRef.current = logsByThread
      return logsByThread
    }),
    resolveDiffCwd: vi.fn(() => '/repo'),
    ...overrides,
  }
}

describe('threadDataOps', () => {
  it('skips history cursor/source writes when values are unchanged', () => {
    const ctx = createBaseContext({
      historyCursorByThreadIdRef: { current: { 'thread-1': 'cursor-same' } },
      transcriptSourceByThreadRef: { current: { 'thread-1': 'history' } },
    })
    const ops = createThreadDataOps(ctx)

    ops.setThreadTranscriptSource('thread-1', 'history')
    expect(ctx.setTranscriptSourceByThreadId).not.toHaveBeenCalled()

    ops.setThreadHistoryLoading('thread-1', false)
    expect(ctx.setHistoryLoadingByThreadId).not.toHaveBeenCalled()
  })

  it('skips history clear writes when no history state exists for the thread', () => {
    const ctx = createBaseContext({
      historyLoadingRef: { current: {} },
      historyCursorByThreadIdRef: { current: {} },
    })
    const ops = createThreadDataOps(ctx)

    ops.clearThreadHistoryCursor('thread-missing')

    expect(ctx.setHistoryLoadingByThreadId).not.toHaveBeenCalled()
    expect(ctx.setHistoryCursorByThreadId).not.toHaveBeenCalled()
  })

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
    const ops = createThreadDataOps(ctx)

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
    const ops = createThreadDataOps(ctx)

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
    const ops = createThreadDataOps(ctx)

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

  it('loads thread history and updates transcript source to history', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: 'cursor-next' }),
      activeThreadIdRef: { current: 'thread-1' },
    })
    const ops = createThreadDataOps(ctx)

    await expect(ops.loadThreadHistory('thread-1')).resolves.toBe(true)

    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'clear_pending_inputs' })
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'replace_logs',
      logs: [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }],
    })
    expect(ctx.request).toHaveBeenCalledWith('thread/messages', { threadId: 'thread-1', limit: 50 })
    expect(ctx.setTranscriptSourceByThreadId).toHaveBeenCalled()
    expect(ctx.transcriptSourceByThreadRef.current['thread-1']).toBe('history')
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
    const ops = createThreadDataOps(ctx)

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

  it('loads earlier history from refs when transcript source is history', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: 'cursor-next' }),
      activeThreadIdRef: { current: 'thread-1' },
      historyCursorByThreadIdRef: { current: { 'thread-1': 'cursor-prev' } },
      transcriptSourceByThreadRef: { current: { 'thread-1': 'history' } },
      logsByThreadIdRef: {
        current: {
          'thread-1': [{ id: 'existing-log', kind: 'message', role: 'assistant', text: 'existing' }],
        },
      },
    })
    const ops = createThreadDataOps(ctx)

    await ops.loadEarlierHistory()

    expect(ctx.request).toHaveBeenCalledWith('thread/messages', {
      threadId: 'thread-1',
      limit: 50,
      cursor: 'cursor-prev',
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'prepend_logs',
      logs: [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }],
    })
  })

  it('bootstraps history from replay source before loading earlier pages', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [], nextCursor: 'cursor-prev' })
      .mockResolvedValueOnce({ data: [], nextCursor: 'cursor-next' })
    const ctx = createBaseContext({
      request,
      activeThreadIdRef: { current: 'thread-1' },
      transcriptSourceByThreadRef: { current: { 'thread-1': 'replay' } },
    })
    const ops = createThreadDataOps(ctx)

    await ops.loadEarlierHistory()

    expect(request).toHaveBeenNthCalledWith(1, 'thread/messages', {
      threadId: 'thread-1',
      limit: 50,
    })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/messages', {
      threadId: 'thread-1',
      limit: 50,
      cursor: 'cursor-next',
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'replace_logs',
      logs: [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }],
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'prepend_logs',
      logs: [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }],
    })
  })
})
