import { describe, expect, it, vi } from 'vitest'
import { createThreadDataOps, type ThreadDataOpsContext } from './threadDataOps'

vi.mock('../../eventAdapters', () => ({
  mapThreadHistoryToCanonicalLogs: vi.fn(() => [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }]),
}))

vi.mock('../core/rpcParsers', () => ({
  asResolvedInputs: vi.fn(() => []),
  asThreadMessages: vi.fn(() => ({ data: [], nextCursor: 'cursor-next' })),
  asThreadSummaries: vi.fn(() => []),
}))

function createBaseContext(overrides: Partial<ThreadDataOpsContext> = {}): ThreadDataOpsContext {
  let historyLoadingByThread: Record<string, boolean> = {}
  let historyCursorByThread: Record<string, string | null> = {}
  let transcriptSourceByThread: Record<string, 'history' | 'replay'> = {}
  let logsByThread: Record<string, any[]> = {}

  return {
    request: vi.fn(),
    dispatch: vi.fn(),
    log: vi.fn(),
    activeThreadIdRef: { current: 'thread-1' },
    historyLoadTokenRef: { current: 0 },
    historyLoadSeqByThreadRef: { current: {} },
    historyLoadingRef: { current: {} },
    transcriptSourceByThreadRef: { current: {} },
    seenStaleInputIdRef: { current: new Set<string>() },
    setIsRefreshingDiff: vi.fn(),
    setDiffSnapshot: vi.fn(),
    setHistoryLoadingByThreadId: vi.fn((updater) => {
      historyLoadingByThread = updater(historyLoadingByThread)
      return historyLoadingByThread
    }),
    setHistoryCursorByThreadId: vi.fn((updater) => {
      historyCursorByThread = updater(historyCursorByThread)
      return historyCursorByThread
    }),
    setTranscriptSourceByThreadId: vi.fn((updater) => {
      transcriptSourceByThread = updater(transcriptSourceByThread)
      return transcriptSourceByThread
    }),
    setLogsByThreadId: vi.fn((updater) => {
      logsByThread = updater(logsByThread)
      return logsByThread
    }),
    ...overrides,
  }
}

describe('threadDataOps', () => {
  it('refreshes workspace diff with loading state transitions', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ diff: 'ok' }),
    })
    const ops = createThreadDataOps(ctx)

    await ops.refreshWorkspaceDiff()

    expect(ctx.setIsRefreshingDiff).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsRefreshingDiff).toHaveBeenLastCalledWith(false)
    expect(ctx.setDiffSnapshot).toHaveBeenCalledWith({ diff: 'ok' })
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
})
