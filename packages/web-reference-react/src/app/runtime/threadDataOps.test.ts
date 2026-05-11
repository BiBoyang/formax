import { describe, expect, it, vi } from 'vitest'
import { createThreadDataOps, type ThreadDataOpsContext } from './threadDataOps'
import type { CompactBoundarySummary, RequestCollapseSummary } from '../../types'

vi.mock('../../eventAdapters', () => ({
  mapThreadHistoryToCanonicalLogs: vi.fn(() => [{ id: 'mapped-log', kind: 'message', role: 'assistant', text: 'ok' }]),
}))

vi.mock('../core/rpcContracts', () => ({
  parseThreadResumeResponse: vi.fn(() => ({
    thread: { id: 'thread-1', cwd: '/tmp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    staleInputs: [],
  })),
  parseThreadMessagesResponse: vi.fn(() => ({ data: [], nextCursor: 'cursor-next' })),
  parseThreadListResponse: vi.fn(() => []),
}))

function createBaseContext(overrides: Partial<ThreadDataOpsContext> = {}): ThreadDataOpsContext {
  let historyLoadingByThread: Record<string, boolean> = {}
  let historyCursorByThread: Record<string, string | null> = {}
  let transcriptSourceByThread: Record<string, 'history' | 'replay'> = {}
  let latestCompactBoundaryByThread: Record<string, CompactBoundarySummary | null> = {}
  let latestRequestCollapseByThread: Record<string, RequestCollapseSummary | null> = {}
  let logsByThread: Record<string, any[]> = {}
  const historyCursorByThreadIdRef = { current: {} as Record<string, string | null> }
  const logsByThreadIdRef = { current: {} as Record<string, any[]> }
  const latestCompactBoundaryByThreadIdRef = {
    current: {} as Record<string, CompactBoundarySummary | null>,
  }
  const latestRequestCollapseByThreadIdRef = {
    current: {} as Record<string, RequestCollapseSummary | null>,
  }

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
    latestCompactBoundaryByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    logsByThreadIdRef,
    stateLogsRef: { current: [] },
    seenStaleInputIdRef: { current: new Set<string>() },
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
    setLatestCompactBoundaryByThreadId: vi.fn((updater) => {
      latestCompactBoundaryByThread = updater(latestCompactBoundaryByThread)
      latestCompactBoundaryByThreadIdRef.current = latestCompactBoundaryByThread
      return latestCompactBoundaryByThread
    }),
    setLatestRequestCollapseByThreadId: vi.fn((updater) => {
      latestRequestCollapseByThread = updater(latestRequestCollapseByThread)
      latestRequestCollapseByThreadIdRef.current = latestRequestCollapseByThread
      return latestRequestCollapseByThread
    }),
    setLogsByThreadId: vi.fn((updater) => {
      logsByThread = updater(logsByThread)
      logsByThreadIdRef.current = logsByThread
      return logsByThread
    }),
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

  it('caches latest request collapse from thread history responses', async () => {
    const requestCollapse = {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 41,
      recapFingerprint: 'fp-123',
    } as const
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: 'cursor-next' }),
      activeThreadIdRef: { current: 'thread-1' },
    })
    const { parseThreadMessagesResponse } = await import('../core/rpcContracts')
    vi.mocked(parseThreadMessagesResponse).mockReturnValueOnce({
      data: [],
      nextCursor: 'cursor-next',
      latestRequestCollapse: requestCollapse,
    })
    const ops = createThreadDataOps(ctx)

    await expect(ops.loadThreadHistory('thread-1')).resolves.toBe(true)

    expect(ctx.setLatestRequestCollapseByThreadId).toHaveBeenCalled()
    expect(ctx.latestRequestCollapseByThreadIdRef.current['thread-1']).toEqual(requestCollapse)
  })

  it('caches latest compact boundary from thread history responses', async () => {
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'auto',
      preTokens: 2048,
      summaryKind: 'session_memory',
    } as const
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: 'cursor-next' }),
      activeThreadIdRef: { current: 'thread-1' },
    })
    const { parseThreadMessagesResponse } = await import('../core/rpcContracts')
    vi.mocked(parseThreadMessagesResponse).mockReturnValueOnce({
      data: [],
      nextCursor: 'cursor-next',
      latestCompactBoundary,
    })
    const ops = createThreadDataOps(ctx)

    await expect(ops.loadThreadHistory('thread-1')).resolves.toBe(true)

    expect(ctx.setLatestCompactBoundaryByThreadId).toHaveBeenCalled()
    expect(ctx.latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(latestCompactBoundary)
  })

  it('preserves cached latest request collapse when response omits the field', async () => {
    const requestCollapse = {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 41,
      recapFingerprint: 'fp-123',
    } as const
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ data: [], nextCursor: 'cursor-next' }),
      activeThreadIdRef: { current: 'thread-1' },
      latestRequestCollapseByThreadIdRef: {
        current: { 'thread-1': requestCollapse },
      },
    })
    const { parseThreadMessagesResponse } = await import('../core/rpcContracts')
    vi.mocked(parseThreadMessagesResponse).mockReturnValueOnce({
      data: [],
      nextCursor: 'cursor-next',
    })
    const ops = createThreadDataOps(ctx)

    await expect(ops.loadThreadHistory('thread-1')).resolves.toBe(true)

    expect(ctx.setLatestRequestCollapseByThreadId).not.toHaveBeenCalled()
    expect(ctx.latestRequestCollapseByThreadIdRef.current['thread-1']).toEqual(requestCollapse)
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

  it('caches latest compact boundary from thread/resume responses', async () => {
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'reactive',
      preTokens: 1536,
      summaryKind: 'model_summary',
    } as const
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({}),
    })
    const { parseThreadResumeResponse } = await import('../core/rpcContracts')
    vi.mocked(parseThreadResumeResponse).mockReturnValueOnce({
      thread: {
        id: 'thread-1',
        cwd: '/tmp',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      staleInputs: [],
      latestCompactBoundary,
    })
    const ops = createThreadDataOps(ctx)

    await ops.resumeThreadInputs('thread-1')

    expect(ctx.setLatestCompactBoundaryByThreadId).toHaveBeenCalled()
    expect(ctx.latestCompactBoundaryByThreadIdRef.current['thread-1']).toEqual(latestCompactBoundary)
  })
})
