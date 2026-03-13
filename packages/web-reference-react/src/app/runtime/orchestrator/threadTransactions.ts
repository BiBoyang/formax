import type { Dispatch } from 'react'
import type { AppAction } from '../../../store'
import type { PendingInput, ThreadSummary, TranscriptItem } from '../../../types'
import { type ArchiveThreadLike, type ReplMode, resolveArchiveSelection } from '../../../semantics'
import { selectThreadTranscriptLogs } from '../../core/logSelectors'

export type ThreadListItem = {
  id: string
  cwd?: string
  createdAt?: string
  updatedAt: string
  messageCount?: number | null
  label?: string | null
  lastUserPrompt?: string | null
}

export type SelectThreadOptions = { restoreOnReplayFailure?: boolean }

export type ThreadTransactionsContext = {
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
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  resumeThreadInputs: (threadId: string) => Promise<void>
  refreshWorkspaceDiff: (cwdOverride?: string | null) => Promise<void>
  trackArchiveOp?: (args: { opId: string; threadId: string; thread: ArchiveThreadLike | null | undefined }) => void
  clearArchiveOp?: (opId: string) => boolean
}

function toThreadSummary(thread: ThreadListItem): ThreadSummary {
  return {
    id: thread.id,
    cwd: thread.cwd ?? '',
    createdAt: thread.createdAt ?? thread.updatedAt,
    updatedAt: thread.updatedAt,
    messageCount: typeof thread.messageCount === 'number' ? thread.messageCount : 0,
    label: thread.label ?? null,
    lastUserPrompt: thread.lastUserPrompt ?? null,
  }
}

function createArchiveOpId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `archive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createThreadTransactions(ctx: ThreadTransactionsContext) {
  const applyActiveThreadState = (threadId: string, logs: TranscriptItem[]) => {
    ctx.setMode(ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal')
    ctx.activeThreadIdRef.current = threadId
    ctx.dispatch({ type: 'set_active_thread', threadId })
    ctx.dispatch({ type: 'set_active_turn', turnId: null })
    ctx.dispatch({ type: 'clear_pending_inputs' })
    ctx.dispatch({ type: 'replace_logs', logs })
  }

  const clearActiveThreadState = (logs: TranscriptItem[], options?: { clearPendingInputs?: boolean }) => {
    const shouldClearPendingInputs = options?.clearPendingInputs ?? true
    ctx.activeThreadIdRef.current = null
    ctx.setMode('normal')
    ctx.dispatch({ type: 'set_active_thread', threadId: null })
    ctx.dispatch({ type: 'set_active_turn', turnId: null })
    if (shouldClearPendingInputs) {
      ctx.dispatch({ type: 'clear_pending_inputs' })
    }
    ctx.dispatch({ type: 'replace_logs', logs })
  }

  const restorePendingInputsState = (snapshot: {
    pendingInputs: Record<string, PendingInput>
    selectedInputId: string | null
  }) => {
    ctx.dispatch({ type: 'clear_pending_inputs' })
    for (const input of Object.values(snapshot.pendingInputs)) {
      ctx.dispatch({ type: 'input_requested', input })
    }
    ctx.dispatch({ type: 'set_selected_input', inputId: snapshot.selectedInputId })
  }

  const selectThread = (threadId: string, options?: SelectThreadOptions) => {
    const restoreOnReplayFailure = options?.restoreOnReplayFailure ?? true
    if (threadId === ctx.state.activeThreadId) return
    const nextThread = ctx.state.threads.find((thread) => thread.id === threadId)
    if (nextThread?.cwd) {
      ctx.setSelectedCwd(nextThread.cwd)
    }
    const previousThreadId = ctx.state.activeThreadId
    const previousLogs = ctx.state.logs
    const cachedLogs = selectThreadTranscriptLogs({ threadId, logsByThreadId: ctx.logsByThreadId, fallbackLogs: [] })
    applyActiveThreadState(threadId, cachedLogs)
    void (async () => {
      const hasReplayCursor = typeof ctx.replayCursorByThreadRef.current[threadId] === 'number'
      const replayLoaded = await ctx.replayThreadEvents(threadId, { fromStart: !hasReplayCursor }).catch(() => false)
      if (!replayLoaded) {
        if (restoreOnReplayFailure && ctx.activeThreadIdRef.current === threadId) {
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
          ctx.log('Failed to hydrate selected thread transcript. Restored previous thread.', 'warn')
        } else if (!restoreOnReplayFailure) {
          ctx.log('Failed to hydrate selected thread transcript after archive fallback. Keeping fallback selection.', 'warn')
          if (ctx.activeThreadIdRef.current === threadId) {
            void ctx.refreshWorkspaceDiff(nextThread?.cwd ?? null).catch(() => undefined)
          }
        }
        return
      }
      if (ctx.activeThreadIdRef.current !== threadId) return
      await ctx.resumeThreadInputs(threadId)
      await ctx.refreshWorkspaceDiff(nextThread?.cwd ?? null)
    })().catch(() => undefined)
  }

  const archiveThread = async (threadId: string) => {
    if (!threadId) return
    const archivedThread = ctx.state.threads.find((thread) => thread.id === threadId)
    const selection = resolveArchiveSelection({
      activeThreadId: ctx.state.activeThreadId,
      archivedThreadId: threadId,
      orderedThreadIds: ctx.sortedThreads.map((thread) => thread.id),
    })
    const snapshot = {
      threads: ctx.state.threads,
      activeThreadId: ctx.state.activeThreadId,
      activeTurnId: ctx.state.activeTurnId,
      selectedInputId: ctx.state.selectedInputId,
      pendingInputs: ctx.state.pendingInputs,
      logs: ctx.state.logs,
      selectedCwd: ctx.selectedCwd,
    }
    const opId = createArchiveOpId()

    const nextThreads = snapshot.threads.filter((thread) => thread.id !== threadId)
    ctx.dispatch({ type: 'set_threads', threads: nextThreads.map(toThreadSummary) })

    if (selection.shouldSwitchActiveThread) {
      if (selection.nextActiveThreadId) {
        selectThread(selection.nextActiveThreadId, { restoreOnReplayFailure: false })
      } else {
        clearActiveThreadState([])
        ctx.setSelectedCwd(null)
      }
    }

    ctx.trackArchiveOp?.({ opId, threadId, thread: archivedThread ?? null })

    try {
      await ctx.request('thread/archive', { threadId, opId })
      if (selection.shouldSwitchActiveThread && !selection.nextActiveThreadId) {
        await ctx.refreshWorkspaceDiff(null).catch((error) => {
          const message = error instanceof Error ? error.message : 'Unknown error'
          ctx.log(`Diff refresh failed after archive: ${message}`, 'warn')
        })
      }
    } catch (error) {
      const shouldRollback = ctx.clearArchiveOp ? ctx.clearArchiveOp(opId) : true
      if (!shouldRollback) {
        return
      }
      ctx.dispatch({ type: 'set_threads', threads: snapshot.threads.map(toThreadSummary) })
      restorePendingInputsState({
        pendingInputs: snapshot.pendingInputs,
        selectedInputId: snapshot.selectedInputId,
      })
      if (snapshot.activeThreadId) {
        const previousThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId)
        ctx.setSelectedCwd(previousThread?.cwd ?? snapshot.selectedCwd)
        ctx.setMode(ctx.runtimeStateByThreadRef.current[snapshot.activeThreadId]?.mode ?? 'normal')
        ctx.activeThreadIdRef.current = snapshot.activeThreadId
        ctx.dispatch({ type: 'set_active_thread', threadId: snapshot.activeThreadId })
        ctx.dispatch({ type: 'set_active_turn', turnId: snapshot.activeTurnId })
        ctx.dispatch({ type: 'replace_logs', logs: snapshot.logs })
        await ctx.refreshWorkspaceDiff(previousThread?.cwd ?? snapshot.selectedCwd ?? null).catch(() => undefined)
      } else {
        ctx.setSelectedCwd(snapshot.selectedCwd)
        clearActiveThreadState(snapshot.logs, { clearPendingInputs: false })
        await ctx.refreshWorkspaceDiff(snapshot.selectedCwd ?? null).catch(() => undefined)
      }
      const message = error instanceof Error ? error.message : 'Archive failed'
      ctx.log(`Archive failed: ${message}`, 'error')
    }
  }

  return {
    selectThread,
    archiveThread,
    clearActiveThreadState,
  }
}
