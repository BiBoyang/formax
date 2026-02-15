import { mapThreadHistoryToCanonicalLogs } from '../../eventAdapters'
import type { DiffFilePatchPayload, DiffSnapshot } from '../../components/WorktreeDiffPane'
import { asResolvedInputs, asThreadMessages, asThreadSummaries } from '../core/rpcParsers'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import type { TranscriptItem } from '../../types'

export type ThreadDataOpsContext = {
  request: (method: string, params?: unknown) => Promise<any>
  dispatch: (action: any) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  activeThreadIdRef: { current: string | null }
  historyLoadTokenRef: { current: number }
  historyLoadSeqByThreadRef: { current: Record<string, number> }
  historyLoadingRef: { current: Record<string, boolean> }
  transcriptSourceByThreadRef: { current: Record<string, ThreadTranscriptSource> }
  seenStaleInputIdRef: { current: Set<string> }
  setIsRefreshingDiff: (value: boolean) => void
  setDiffSnapshot: (value: DiffSnapshot | null) => void
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
  setLogsByThreadId: (
    updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>,
  ) => void
  resolveDiffCwd: () => string | null
}

function asDiffSnapshot(value: unknown): DiffSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.files)) return null
  const files = raw.files
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const file = entry as Record<string, unknown>
      if (typeof file.path !== 'string') return null
      return {
        path: file.path,
        additions: typeof file.additions === 'number' ? file.additions : 0,
        deletions: typeof file.deletions === 'number' ? file.deletions : 0,
        patch: typeof file.patch === 'string' ? file.patch : undefined,
        untracked: file.untracked === true ? true : undefined,
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)

  return {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    hasChanges: raw.hasChanges === true,
    truncated: raw.truncated === true,
    files,
  }
}

function hasDiffErrorMarker(snapshot: DiffSnapshot): boolean {
  return snapshot.files.some((file) => file.path === 'git-diff-error')
}

function asDiffFilePatchPayload(value: unknown): DiffFilePatchPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const file = raw.file
  if (!file || typeof file !== 'object') {
    return {
      path: typeof raw.path === 'string' ? raw.path : '',
      found: raw.found === true,
      truncated: raw.truncated === true,
      patch: '',
      additions: 0,
      deletions: 0,
      untracked: undefined,
    }
  }
  const rawFile = file as Record<string, unknown>
  return {
    path: typeof rawFile.path === 'string' ? rawFile.path : typeof raw.path === 'string' ? raw.path : '',
    found: raw.found === true,
    truncated: raw.truncated === true,
    patch: typeof rawFile.patch === 'string' ? rawFile.patch : '',
    additions: typeof rawFile.additions === 'number' ? rawFile.additions : 0,
    deletions: typeof rawFile.deletions === 'number' ? rawFile.deletions : 0,
    untracked: rawFile.untracked === true ? true : undefined,
  }
}

export function createThreadDataOps(ctx: ThreadDataOpsContext) {
  const refreshThreads = async () => {
    const result = await ctx.request('thread/list', { limit: 50 })
    ctx.dispatch({ type: 'set_threads', threads: asThreadSummaries(result) })
  }

  const refreshWorkspaceDiff = async (cwdOverride?: string | null) => {
    ctx.setIsRefreshingDiff(true)
    try {
      const cwd = cwdOverride ?? ctx.resolveDiffCwd()
      const summaryParams = { maxFiles: 600, ...(cwd ? { cwd } : {}) }
      const summaryResult = await ctx.request('bridge/readDiffSummary', summaryParams).catch(() => null)
      const summarySnapshot = asDiffSnapshot(summaryResult)
      if (summarySnapshot && !hasDiffErrorMarker(summarySnapshot)) {
        ctx.setDiffSnapshot(summarySnapshot)
        return
      }

      const legacyResult = await ctx.request('bridge/readDiff', { maxBytes: 180 * 1024, ...(cwd ? { cwd } : {}) })
      const legacySnapshot = asDiffSnapshot(legacyResult)
      if (legacySnapshot) {
        ctx.setDiffSnapshot(legacySnapshot)
      }
    } finally {
      ctx.setIsRefreshingDiff(false)
    }
  }

  const requestDiffFilePatch = async (filePath: string, cwdOverride?: string | null): Promise<DiffFilePatchPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const result = await ctx
      .request('bridge/readDiffFilePatch', { path, maxBytes: 220 * 1024, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    const payload = asDiffFilePatchPayload(result)
    if (!payload) return null
    return payload
  }

  const setThreadHistoryLoading = (threadId: string, loading: boolean) => {
    if (loading) {
      ctx.historyLoadingRef.current = { ...ctx.historyLoadingRef.current, [threadId]: true }
    } else {
      const nextRef = { ...ctx.historyLoadingRef.current }
      delete nextRef[threadId]
      ctx.historyLoadingRef.current = nextRef
    }

    ctx.setHistoryLoadingByThreadId((prev) => {
      const current = Boolean(prev[threadId])
      if (current === loading) return prev
      if (loading) return { ...prev, [threadId]: true }
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }

  const setThreadTranscriptSource = (threadId: string, source: ThreadTranscriptSource) => {
    ctx.transcriptSourceByThreadRef.current = { ...ctx.transcriptSourceByThreadRef.current, [threadId]: source }
    ctx.setTranscriptSourceByThreadId((prev) => {
      if (prev[threadId] === source) return prev
      return { ...prev, [threadId]: source }
    })
  }

  const clearThreadHistoryCursor = (threadId: string) => {
    const nextHistoryLoadingRef = { ...ctx.historyLoadingRef.current }
    delete nextHistoryLoadingRef[threadId]
    ctx.historyLoadingRef.current = nextHistoryLoadingRef

    ctx.setHistoryLoadingByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })

    ctx.setHistoryCursorByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
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

      const parsed = asThreadMessages(historyResult)
      const logs = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      ctx.dispatch({ type: 'clear_pending_inputs' })
      ctx.dispatch({ type: 'replace_logs', logs })
      ctx.setLogsByThreadId((prev) => ({ ...prev, [threadId]: logs }))
      ctx.setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
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
      const staleInputs = asResolvedInputs(resumeResult)
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

  const loadEarlierHistory = async (args: {
    activeThreadId: string | null
    historyCursorByThreadId: Record<string, string | null>
    activeLogs: TranscriptItem[]
  }) => {
    const threadId = args.activeThreadId
    if (!threadId || ctx.historyLoadingRef.current[threadId]) return
    if (ctx.transcriptSourceByThreadRef.current[threadId] !== 'history') return
    const cursor = args.historyCursorByThreadId[threadId]
    if (!cursor) return

    const token = ctx.historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const result = await ctx.request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== ctx.historyLoadTokenRef.current) return
      if (ctx.activeThreadIdRef.current !== threadId) return

      const parsed = asThreadMessages(result)
      const prepended = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      ctx.dispatch({ type: 'prepend_logs', logs: prepended })
      ctx.setLogsByThreadId((prev) => {
        const current = prev[threadId] ?? args.activeLogs
        return { ...prev, [threadId]: [...prepended, ...current] }
      })
      ctx.setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }

  return {
    refreshThreads,
    refreshWorkspaceDiff,
    requestDiffFilePatch,
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
