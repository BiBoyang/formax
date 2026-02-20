import type { Dispatch } from 'react'
import type { AppAction } from '../../store'
import type { PendingInput, TranscriptItem } from '../../types'
import {
  type ReplMode,
  type ArchiveThreadLike,
} from '../../semantics'
import { selectThreadTranscriptLogs } from '../core/logSelectors'
import { parseThreadStartResponse } from '../core/rpcContracts'
import {
  createThreadTransactions,
  type ThreadListItem,
} from './orchestrator/threadTransactions'
export type { SelectThreadOptions } from './orchestrator/threadTransactions'

export type ThreadActionsContext = {
  selectedCwd: string | null
  setSelectedCwd: (value: string | null) => void
  state: {
    activeThreadId: string | null
    activeTurnId: string | null
    selectedInputId: string | null
    pendingInputs: Record<string, PendingInput>
    logs: TranscriptItem[]
    threads: ThreadListItem[]
  }
  sortedThreads: ThreadListItem[]
  logsByThreadId: Record<string, TranscriptItem[]>
  request: (method: string, params?: unknown) => Promise<unknown>
  dispatch: Dispatch<AppAction>
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
  setMode: (mode: ReplMode) => void
  runtimeStateByThreadRef: { current: Record<string, { mode: ReplMode }> }
  replayCursorByThreadRef: { current: Record<string, number> }
  activeThreadIdRef: { current: string | null }
  setIsThreadActionBusy: (busy: boolean) => void
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  resumeThreadInputs: (threadId: string) => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: (cwdOverride?: string | null) => Promise<void>
  trackArchiveOp?: (args: { opId: string; threadId: string; thread: ArchiveThreadLike | null | undefined }) => void
  clearArchiveOp?: (opId: string) => boolean
  loadEarlierHistoryAction: () => Promise<void>
}

export function createThreadActions(ctx: ThreadActionsContext) {
  const transactions = createThreadTransactions({
    selectedCwd: ctx.selectedCwd,
    setSelectedCwd: ctx.setSelectedCwd,
    state: ctx.state,
    sortedThreads: ctx.sortedThreads,
    logsByThreadId: ctx.logsByThreadId,
    request: ctx.request,
    dispatch: ctx.dispatch,
    log: ctx.log,
    setMode: ctx.setMode,
    runtimeStateByThreadRef: ctx.runtimeStateByThreadRef,
    replayCursorByThreadRef: ctx.replayCursorByThreadRef,
    activeThreadIdRef: ctx.activeThreadIdRef,
    replayThreadEvents: ctx.replayThreadEvents,
    resumeThreadInputs: ctx.resumeThreadInputs,
    refreshWorkspaceDiff: ctx.refreshWorkspaceDiff,
    trackArchiveOp: ctx.trackArchiveOp,
    clearArchiveOp: ctx.clearArchiveOp,
  })

  const startThread = async () => {
    const previousThreadId = ctx.state.activeThreadId
    const previousLogs = ctx.state.logs
    ctx.setIsThreadActionBusy(true)
    try {
      const result = await ctx.request('thread/start', ctx.selectedCwd ? { cwd: ctx.selectedCwd } : {})
      const thread = parseThreadStartResponse(result)
      if (!thread) return

      if (thread.cwd) {
        ctx.setSelectedCwd(thread.cwd)
      }
      ctx.setMode(ctx.runtimeStateByThreadRef.current[thread.id]?.mode ?? 'normal')
      ctx.activeThreadIdRef.current = thread.id
      ctx.dispatch({ type: 'set_active_thread', threadId: thread.id })
      ctx.dispatch({ type: 'set_active_turn', turnId: null })
      ctx.dispatch({ type: 'clear_pending_inputs' })
      ctx.dispatch({
        type: 'replace_logs',
        logs: selectThreadTranscriptLogs({ threadId: thread.id, logsByThreadId: ctx.logsByThreadId, fallbackLogs: [] }),
      })
      const replayLoaded = await ctx.replayThreadEvents(thread.id, { fromStart: true })
      if (!replayLoaded) {
        ctx.activeThreadIdRef.current = previousThreadId
        ctx.dispatch({ type: 'set_active_thread', threadId: previousThreadId })
        ctx.dispatch({
          type: 'replace_logs',
          logs: selectThreadTranscriptLogs({
            threadId: previousThreadId,
            logsByThreadId: ctx.logsByThreadId,
            fallbackLogs: previousLogs,
          }),
        })
        ctx.log('Failed to hydrate new thread transcript. Restored previous thread.', 'warn')
        return
      }
      await ctx.resumeThreadInputs(thread.id)
      await ctx.refreshThreads()
      await ctx.refreshWorkspaceDiff(thread.cwd ?? ctx.selectedCwd ?? null)
      ctx.log(`Thread created: ${thread.id}`)
    } finally {
      ctx.setIsThreadActionBusy(false)
    }
  }

  const selectThread = transactions.selectThread

  const selectCwd = (cwd: string) => {
    if (!cwd || cwd === ctx.selectedCwd) return
    ctx.setSelectedCwd(cwd)
    const targetThread = ctx.sortedThreads.find((thread) => thread.cwd === cwd)
    if (!targetThread) {
      transactions.clearActiveThreadState([])
      void ctx.refreshWorkspaceDiff(cwd).catch(() => undefined)
      return
    }
    if (targetThread.id !== ctx.state.activeThreadId) {
      selectThread(targetThread.id)
      return
    }
    void ctx.refreshWorkspaceDiff(cwd).catch(() => undefined)
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

  const archiveThread = async (threadId: string) => {
    if (!threadId) return
    ctx.setIsThreadActionBusy(true)
    try {
      await transactions.archiveThread(threadId)
    } finally {
      ctx.setIsThreadActionBusy(false)
    }
  }

  const loadEarlierHistory = async () => ctx.loadEarlierHistoryAction()

  return {
    startThread,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
  }
}
