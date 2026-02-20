import type { Dispatch } from 'react'
import type { AppAction } from '../../store'
import type { PendingInput, TranscriptItem } from '../../types'
import type { ThreadSummary } from '../../types'
import {
  type ReplMode,
  type ArchiveThreadLike,
  resolveArchiveSelection,
} from '../../semantics'
import { selectThreadTranscriptLogs } from '../core/logSelectors'

type ThreadListItem = {
  id: string
  cwd?: string
  createdAt?: string
  updatedAt: string
  messageCount?: number | null
  label?: string | null
  lastUserPrompt?: string | null
}

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

export type SelectThreadOptions = { restoreOnReplayFailure?: boolean }

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function parseThreadStartResponse(value: unknown): { id: string; cwd?: string } | null {
  const record = asRecord(value)
  const thread = asRecord(record.thread)
  const id = typeof thread.id === 'string' ? thread.id : ''
  if (!id) return null
  const cwd = typeof thread.cwd === 'string' ? thread.cwd : undefined
  return { id, ...(cwd ? { cwd } : {}) }
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

export function createThreadActions(ctx: ThreadActionsContext) {
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

  const selectCwd = (cwd: string) => {
    if (!cwd || cwd === ctx.selectedCwd) return
    ctx.setSelectedCwd(cwd)
    const targetThread = ctx.sortedThreads.find((thread) => thread.cwd === cwd)
    if (!targetThread) {
      clearActiveThreadState([])
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
    const opId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `archive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    const nextThreads = snapshot.threads.filter((thread) => thread.id !== threadId)
    ctx.dispatch({ type: 'set_threads', threads: nextThreads.map(toThreadSummary) })

    if (selection.shouldSwitchActiveThread) {
      if (selection.nextActiveThreadId) {
        // Reuse full selection path so replay/resume/diff hydration stays consistent.
        selectThread(selection.nextActiveThreadId, { restoreOnReplayFailure: false })
      } else {
        clearActiveThreadState([])
        ctx.setSelectedCwd(null)
      }
    }

    ctx.trackArchiveOp?.({ opId, threadId, thread: archivedThread ?? null })

    ctx.setIsThreadActionBusy(true)
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
