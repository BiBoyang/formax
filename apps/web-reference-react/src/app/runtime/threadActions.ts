import { mapThreadHistoryToCanonicalLogs } from '../../eventAdapters'
import { asThreadMessages } from '../core/rpcParsers'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import type { TranscriptItem } from '../../types'

export type ThreadActionsContext = {
  selectedCwd: string | null
  setSelectedCwd: (value: string | null) => void
  state: {
    activeThreadId: string | null
    activeTurnId: string | null
    logs: TranscriptItem[]
    threads: Array<{ id: string; cwd?: string; updatedAt: string }>
  }
  sortedThreads: Array<{ id: string; cwd?: string; updatedAt: string }>
  logsByThreadId: Record<string, TranscriptItem[]>
  historyCursorByThreadId: Record<string, string | null>
  request: (method: string, params?: unknown) => Promise<any>
  dispatch: (action: any) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  setMode: (mode: 'normal' | 'plan' | 'acceptEdits') => void
  runtimeStateByThreadRef: { current: Record<string, { mode: 'normal' | 'plan' | 'acceptEdits' }> }
  replayCursorByThreadRef: { current: Record<string, number> }
  activeThreadIdRef: { current: string | null }
  historyLoadTokenRef: { current: number }
  historyLoadingRef: { current: Record<string, boolean> }
  transcriptSourceByThreadRef: { current: Record<string, ThreadTranscriptSource> }
  beginThreadHistoryRequest: (threadId: string) => number
  endThreadHistoryRequest: (threadId: string, seq: number) => void
  setIsThreadActionBusy: (busy: boolean) => void
  setLogsByThreadId: (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => void
  setHistoryCursorByThreadId: (
    updater: (prev: Record<string, string | null>) => Record<string, string | null>,
  ) => void
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  resumeThreadInputs: (threadId: string) => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
}

export function createThreadActions(ctx: ThreadActionsContext) {
  const startThread = async () => {
    const previousThreadId = ctx.state.activeThreadId
    const previousLogs = ctx.state.logs
    ctx.setIsThreadActionBusy(true)
    try {
      const result = await ctx.request('thread/start', ctx.selectedCwd ? { cwd: ctx.selectedCwd } : {})
      const thread = result?.thread as { id?: string; cwd?: string } | undefined
      if (!thread?.id) return

      if (thread.cwd) {
        ctx.setSelectedCwd(thread.cwd)
      }
      ctx.setMode(ctx.runtimeStateByThreadRef.current[thread.id]?.mode ?? 'normal')
      ctx.activeThreadIdRef.current = thread.id
      ctx.dispatch({ type: 'set_active_thread', threadId: thread.id })
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      ctx.dispatch({ type: 'clear_pending_inputs' })
      ctx.dispatch({ type: 'replace_logs', logs: ctx.logsByThreadId[thread.id] ?? [] })
      const replayLoaded = await ctx.replayThreadEvents(thread.id, { fromStart: true })
      if (!replayLoaded) {
        ctx.activeThreadIdRef.current = previousThreadId
        ctx.dispatch({ type: 'set_active_thread', threadId: previousThreadId })
        ctx.dispatch({
          type: 'replace_logs',
          logs: previousThreadId ? (ctx.logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
        })
        ctx.log('Failed to hydrate new thread transcript. Restored previous thread.', 'warn')
        return
      }
      await ctx.resumeThreadInputs(thread.id)
      await ctx.refreshThreads()
      await ctx.refreshWorkspaceDiff()
      ctx.log(`Thread created: ${thread.id}`)
    } finally {
      ctx.setIsThreadActionBusy(false)
    }
  }

  const selectThread = (threadId: string) => {
    if (threadId === ctx.state.activeThreadId) return
    const nextThread = ctx.state.threads.find((thread) => thread.id === threadId)
    if (nextThread?.cwd) {
      ctx.setSelectedCwd(nextThread.cwd)
    }
    const previousThreadId = ctx.state.activeThreadId
    const previousLogs = ctx.state.logs
    const cachedLogs = ctx.logsByThreadId[threadId] ?? []
    ctx.setMode(ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal')
    ctx.activeThreadIdRef.current = threadId
    ctx.dispatch({ type: 'set_active_thread', threadId })
    ctx.dispatch({ type: 'set_active_turn', turnId: null })
    ctx.dispatch({ type: 'clear_pending_inputs' })
    ctx.dispatch({ type: 'replace_logs', logs: cachedLogs })
    void (async () => {
      const hasReplayCursor = typeof ctx.replayCursorByThreadRef.current[threadId] === 'number'
      const replayLoaded = await ctx.replayThreadEvents(threadId, { fromStart: !hasReplayCursor }).catch(() => false)
      if (!replayLoaded) {
        if (ctx.activeThreadIdRef.current === threadId) {
          ctx.activeThreadIdRef.current = previousThreadId
          ctx.dispatch({ type: 'set_active_thread', threadId: previousThreadId })
          ctx.dispatch({
            type: 'replace_logs',
            logs: previousThreadId ? (ctx.logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
          })
          ctx.log('Failed to hydrate selected thread transcript. Restored previous thread.', 'warn')
        }
        return
      }
      if (ctx.activeThreadIdRef.current !== threadId) return
      await ctx.resumeThreadInputs(threadId)
    })().catch(() => undefined)
  }

  const selectCwd = (cwd: string) => {
    if (!cwd || cwd === ctx.selectedCwd) return
    ctx.setSelectedCwd(cwd)
    const targetThread = ctx.sortedThreads.find((thread) => thread.cwd === cwd)
    if (!targetThread) {
      ctx.activeThreadIdRef.current = null
      ctx.setMode('normal')
      ctx.dispatch({ type: 'set_active_thread', threadId: null })
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      ctx.dispatch({ type: 'clear_pending_inputs' })
      ctx.dispatch({ type: 'replace_logs', logs: [] })
      return
    }
    if (targetThread.id !== ctx.state.activeThreadId) {
      selectThread(targetThread.id)
    }
  }

  const renameThread = async (threadId: string, label: string) => {
    const nextLabel = label.trim()
    if (!threadId || !nextLabel) return
    ctx.setIsThreadActionBusy(true)
    try {
      await ctx.request('thread/rename', { threadId, label: nextLabel })
      await ctx.refreshThreads()
    } finally {
      ctx.setIsThreadActionBusy(false)
    }
  }

  const loadEarlierHistory = async () => {
    const threadId = ctx.state.activeThreadId
    if (!threadId || ctx.historyLoadingRef.current[threadId]) return
    if (ctx.transcriptSourceByThreadRef.current[threadId] !== 'history') return
    const cursor = ctx.historyCursorByThreadId[threadId]
    if (!cursor) return

    const token = ctx.historyLoadTokenRef.current
    const seq = ctx.beginThreadHistoryRequest(threadId)
    try {
      const result = await ctx.request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== ctx.historyLoadTokenRef.current) return
      if (ctx.activeThreadIdRef.current !== threadId) return
      const parsed = asThreadMessages(result)
      const prepended = mapThreadHistoryToCanonicalLogs({ threadId, messages: parsed.data })
      ctx.dispatch({ type: 'prepend_logs', logs: prepended })
      ctx.setLogsByThreadId((prev) => {
        const current = prev[threadId] ?? ctx.state.logs
        return { ...prev, [threadId]: [...prepended, ...current] }
      })
      ctx.setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
    } finally {
      ctx.endThreadHistoryRequest(threadId, seq)
    }
  }

  return {
    startThread,
    selectThread,
    selectCwd,
    renameThread,
    loadEarlierHistory,
  }
}
