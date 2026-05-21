import { mapThreadHistoryToCanonicalLogs } from '../../eventAdapters'
import {
  parseHiddenThreadGroupCwdsFromThreadList,
  parseThreadResumeResponse,
  parseThreadListResponse,
  parseThreadMessagesResponse,
} from '../core/rpcContracts'
import { areCompactBoundarySummariesEqual } from '../core/compactBoundarySummary'
import { areRequestCollapseSummariesEqual } from '../core/requestCollapseSummary'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import { withRecordValue, withoutRecordKey, type ThreadCompressionProjectionFacts } from '../core/threadCache'
import type { CompactBoundarySummary, RequestCollapseSummary, TranscriptItem } from '../../types'
import type { AppAction } from '../../store'

export type ThreadDataOpsContext = {
  request: (method: string, params?: unknown) => Promise<unknown>
  dispatch: (action: AppAction) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  activeThreadIdRef: { current: string | null }
  historyLoadTokenRef: { current: number }
  historyLoadSeqByThreadRef: { current: Record<string, number> }
  historyLoadingRef: { current: Record<string, boolean> }
  historyCursorByThreadIdRef: { current: Record<string, string | null> }
  transcriptSourceByThreadRef: { current: Record<string, ThreadTranscriptSource> }
  latestCompactBoundaryByThreadIdRef: { current: Record<string, CompactBoundarySummary | null> }
  latestRequestCollapseByThreadIdRef: { current: Record<string, RequestCollapseSummary | null> }
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  stateLogsRef: { current: TranscriptItem[] }
  seenStaleInputIdRef: { current: Set<string> }
  setHistoryLoadingByThreadId: (
    updater: (
      prev: Record<string, boolean>,
    ) => Record<string, boolean>,
  ) => void
  setHistoryCursorByThreadId: (
    updater: (
      prev: Record<string, string | null>,
    ) => Record<string, string | null>,
  ) => void
  setTranscriptSourceByThreadId: (
    updater: (
      prev: Record<string, ThreadTranscriptSource>,
    ) => Record<string, ThreadTranscriptSource>,
  ) => void
  setLatestCompactBoundaryByThreadId: (
    updater: (
      prev: Record<string, CompactBoundarySummary | null>,
    ) => Record<string, CompactBoundarySummary | null>,
  ) => void
  setLatestRequestCollapseByThreadId: (
    updater: (
      prev: Record<string, RequestCollapseSummary | null>,
    ) => Record<string, RequestCollapseSummary | null>,
  ) => void
  setLogsByThreadId: (
    updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>,
  ) => void
  setHiddenGroupCwds?: (next: string[]) => void
}

export function createThreadDataOps(ctx: ThreadDataOpsContext) {
  const areLatestCompactBoundaryEqual = (
    left: CompactBoundarySummary | null | undefined,
    right: CompactBoundarySummary | null | undefined,
  ) => areCompactBoundarySummariesEqual(left, right)

  const setThreadLatestCompactBoundary = (
    threadId: string,
    boundary: CompactBoundarySummary | null | undefined,
  ) => {
    if (boundary === undefined) {
      return
    }
    const nextBoundary = boundary
    if (
      areLatestCompactBoundaryEqual(
        ctx.latestCompactBoundaryByThreadIdRef.current[threadId] ?? null,
        nextBoundary,
      )
    ) {
      return
    }
    ctx.latestCompactBoundaryByThreadIdRef.current = withRecordValue(
      ctx.latestCompactBoundaryByThreadIdRef.current,
      threadId,
      nextBoundary,
    )
    ctx.setLatestCompactBoundaryByThreadId((prev) => withRecordValue(prev, threadId, nextBoundary))
  }

  const setThreadLatestRequestCollapse = (
    threadId: string,
    collapse: RequestCollapseSummary | null | undefined,
  ) => {
    if (collapse === undefined) {
      return
    }
    const nextCollapse = collapse
    if (
      areRequestCollapseSummariesEqual(
        ctx.latestRequestCollapseByThreadIdRef.current[threadId] ?? null,
        nextCollapse,
      )
    ) {
      return
    }
    ctx.latestRequestCollapseByThreadIdRef.current = withRecordValue(
      ctx.latestRequestCollapseByThreadIdRef.current,
      threadId,
      nextCollapse,
    )
    ctx.setLatestRequestCollapseByThreadId((prev) => withRecordValue(prev, threadId, nextCollapse))
  }

  const setThreadCompressionProjectionFacts = (
    threadId: string,
    facts: ThreadCompressionProjectionFacts,
  ): void => {
    setThreadLatestCompactBoundary(threadId, facts.latestCompactBoundary)
    setThreadLatestRequestCollapse(threadId, facts.latestRequestCollapse)
  }

  const refreshThreads = async () => {
    const result = await ctx.request('thread/list', { limit: 50 })
    ctx.dispatch({ type: 'set_threads', threads: parseThreadListResponse(result) })
    ctx.setHiddenGroupCwds?.(parseHiddenThreadGroupCwdsFromThreadList(result))
  }

  const setThreadHistoryLoading = (threadId: string, loading: boolean) => {
    const currentLoading = Boolean(ctx.historyLoadingRef.current[threadId])
    if (currentLoading === loading) return

    ctx.historyLoadingRef.current = loading
      ? withRecordValue(ctx.historyLoadingRef.current, threadId, true)
      : withoutRecordKey(ctx.historyLoadingRef.current, threadId)

    ctx.setHistoryLoadingByThreadId((prev) => {
      const current = Boolean(prev[threadId])
      if (current === loading) return prev
      return loading ? withRecordValue(prev, threadId, true) : withoutRecordKey(prev, threadId)
    })
  }

  const setThreadHistoryCursor = (threadId: string, cursor: string | null) => {
    if ((ctx.historyCursorByThreadIdRef.current[threadId] ?? null) === cursor) {
      return
    }
    ctx.historyCursorByThreadIdRef.current = withRecordValue(
      ctx.historyCursorByThreadIdRef.current,
      threadId,
      cursor,
    )
    ctx.setHistoryCursorByThreadId((prev) => withRecordValue(prev, threadId, cursor))
  }

  const setThreadTranscriptSource = (threadId: string, source: ThreadTranscriptSource) => {
    if (ctx.transcriptSourceByThreadRef.current[threadId] === source) {
      return
    }
    ctx.transcriptSourceByThreadRef.current = withRecordValue(ctx.transcriptSourceByThreadRef.current, threadId, source)
    ctx.setTranscriptSourceByThreadId((prev) => {
      return withRecordValue(prev, threadId, source)
    })
  }

  const clearThreadHistoryCursor = (threadId: string) => {
    const hadLoading = Object.prototype.hasOwnProperty.call(ctx.historyLoadingRef.current, threadId)
    const hadCursor = Object.prototype.hasOwnProperty.call(ctx.historyCursorByThreadIdRef.current, threadId)
    if (!hadLoading && !hadCursor) return

    if (hadLoading) {
      ctx.historyLoadingRef.current = withoutRecordKey(ctx.historyLoadingRef.current, threadId)
      ctx.setHistoryLoadingByThreadId((prev) => {
        return withoutRecordKey(prev, threadId)
      })
    }

    if (hadCursor) {
      ctx.historyCursorByThreadIdRef.current = withoutRecordKey(ctx.historyCursorByThreadIdRef.current, threadId)
      ctx.setHistoryCursorByThreadId((prev) => {
        return withoutRecordKey(prev, threadId)
      })
    }
  }

  const beginThreadHistoryRequest = (threadId: string) => {
    const nextSeq = (ctx.historyLoadSeqByThreadRef.current[threadId] ?? 0) + 1
    ctx.historyLoadSeqByThreadRef.current = { ...ctx.historyLoadSeqByThreadRef.current, [threadId]: nextSeq }
    setThreadHistoryLoading(threadId, true)
    return nextSeq
  }

  const endThreadHistoryRequest = (threadId: string, seq: number) => {
    if (ctx.historyLoadSeqByThreadRef.current[threadId] !== seq) return
    setThreadHistoryLoading(threadId, false)
  }

  const loadThreadHistory = async (threadId: string) => {
    const token = ++ctx.historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const historyResult = await ctx.request('thread/messages', { threadId, limit: 50 })
      if (token !== ctx.historyLoadTokenRef.current) return false
      if (ctx.activeThreadIdRef.current !== threadId) return false

      const parsed = parseThreadMessagesResponse(historyResult)
      const logs = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      ctx.dispatch({ type: 'clear_pending_inputs' })
      ctx.dispatch({ type: 'replace_logs', logs })
      ctx.setLogsByThreadId((prev) => withRecordValue(prev, threadId, logs))
      setThreadCompressionProjectionFacts(threadId, parsed)
      setThreadHistoryCursor(threadId, parsed.nextCursor)
      setThreadTranscriptSource(threadId, 'history')
      return true
    } catch {
      if (token !== ctx.historyLoadTokenRef.current) return false
      if (ctx.activeThreadIdRef.current !== threadId) return false
      return false
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }

  const resumeThreadInputs = async (threadId: string) => {
    try {
      const resumeResult = await ctx.request('thread/resume', { threadId })
      const parsed = parseThreadResumeResponse(resumeResult)
      const staleInputs = parsed?.staleInputs ?? []
      setThreadCompressionProjectionFacts(threadId, parsed ?? {})
      for (const input of staleInputs) {
        if (ctx.seenStaleInputIdRef.current.has(input.inputId)) continue
        ctx.seenStaleInputIdRef.current.add(input.inputId)
        ctx.log(
          `Recovered stale input: ${input.kind} (${input.status})${input.reason ? ` - ${input.reason}` : ''}`,
          input.status === 'failed' ? 'error' : 'warn',
          input.turnId,
        )
      }
    } catch {
      // best-effort resume
    }
  }

  const loadEarlierHistory = async () => {
    const threadId = ctx.activeThreadIdRef.current
    if (!threadId || ctx.historyLoadingRef.current[threadId]) return
    let cursor = ctx.historyCursorByThreadIdRef.current[threadId]
    if (ctx.transcriptSourceByThreadRef.current[threadId] !== 'history') {
      const loaded = await loadThreadHistory(threadId)
      if (!loaded) return
      cursor = ctx.historyCursorByThreadIdRef.current[threadId]
    }
    if (!cursor) return

    const token = ctx.historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const result = await ctx.request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== ctx.historyLoadTokenRef.current) return
      if (ctx.activeThreadIdRef.current !== threadId) return

      const parsed = parseThreadMessagesResponse(result)
      const prepended = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      ctx.dispatch({ type: 'prepend_logs', logs: prepended })
      ctx.setLogsByThreadId((prev) => {
        const current =
          prev[threadId] ??
          ctx.logsByThreadIdRef.current[threadId] ??
          ctx.stateLogsRef.current
        return withRecordValue(prev, threadId, [...prepended, ...current])
      })
      setThreadCompressionProjectionFacts(threadId, parsed)
      setThreadHistoryCursor(threadId, parsed.nextCursor)
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }

  return {
    refreshThreads,
    setThreadHistoryLoading,
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    beginThreadHistoryRequest,
    endThreadHistoryRequest,
    loadThreadHistory,
    resumeThreadInputs,
    loadEarlierHistory,
  }
}
