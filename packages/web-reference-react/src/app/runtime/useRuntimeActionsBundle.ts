import { useEffect, useMemo } from 'react'
import type { ArchiveThreadLike, ThreadRuntimeState } from '../../semantics'
import type { CanonicalEvent } from '../../semantics'
import type { PendingInput, TranscriptItem } from '../../types'
import { createComposerActions, type ComposerActionsContext } from './composerActions'
import {
  createThreadActions,
  type SelectThreadOptions,
  type ThreadActionsContext,
} from './threadActions'
import type { ThreadListItem } from './orchestrator/threadTransactions'
import type { NewThreadDraftState } from './newThreadDraft'

type CoreDeps = {
  request: ThreadActionsContext['request']
  dispatch: ThreadActionsContext['dispatch']
  log: ThreadActionsContext['log']
}

type ThreadDeps = {
  selectedCwdRef: { current: string | null }
  setSelectedCwd: ThreadActionsContext['setSelectedCwd']
  createdThreadCwdByIdRef: ThreadActionsContext['createdThreadCwdByIdRef']
  activeThreadIdRef: ThreadActionsContext['activeThreadIdRef']
  activeTurnIdRef: { current: string | null }
  selectedInputIdRef: { current: string | null }
  pendingInputsRef: { current: Record<string, PendingInput> }
  stateLogsRef: { current: TranscriptItem[] }
  threadsRef: { current: ThreadListItem[] }
  sortedThreadsRef: { current: ThreadListItem[] }
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  setLogsByThreadId: (updater: (prev: Record<string, TranscriptItem[]>) => Record<string, TranscriptItem[]>) => void
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  cacheThreadMode: ThreadActionsContext['cacheThreadMode']
  replayCursorByThreadRef: ThreadActionsContext['replayCursorByThreadRef']
  setMode: ThreadActionsContext['setMode']
  setIsThreadActionBusy: ThreadActionsContext['setIsThreadActionBusy']
  replayThreadEvents: ThreadActionsContext['replayThreadEvents']
  resumeThreadInputs: ThreadActionsContext['resumeThreadInputs']
  refreshThreads: ThreadActionsContext['refreshThreads']
  refreshWorkspaceDiff: ThreadActionsContext['refreshWorkspaceDiff']
  pendingArchiveOpsRef: { current: Map<string, { threadId: string; thread: ArchiveThreadLike | null }> }
  pruneThreadScopedRuntimeRefs: (threads: Array<{ id: string }>) => void
  loadEarlierHistoryAction: ThreadActionsContext['loadEarlierHistoryAction']
  selectThreadRef: { current: (threadId: string, options?: SelectThreadOptions) => void }
}

type ComposerDeps = {
  inputText: ComposerActionsContext['inputText']
  setInputText: ComposerActionsContext['setInputText']
  isSendingTurn: ComposerActionsContext['isSendingTurn']
  isInterruptingTurn: ComposerActionsContext['isInterruptingTurn']
  isSubmittingInput: ComposerActionsContext['isSubmittingInput']
  mode: ComposerActionsContext['mode']
  activeThreadId: ComposerActionsContext['activeThreadId']
  activeTurnId: ComposerActionsContext['activeTurnId']
  newThreadDraft: NewThreadDraftState
  commandByTurnRef: ComposerActionsContext['commandByTurnRef']
  setIsSendingTurn: ComposerActionsContext['setIsSendingTurn']
  setIsInterruptingTurn: ComposerActionsContext['setIsInterruptingTurn']
  setIsSubmittingInput: ComposerActionsContext['setIsSubmittingInput']
  setSubmitStatusByInputId: ComposerActionsContext['setSubmitStatusByInputId']
  toRpcError: ComposerActionsContext['toRpcError']
  nowMs: ComposerActionsContext['nowMs']
  leaveNewThreadDraft: ComposerActionsContext['leaveNewThreadDraft']
  newThreadDraftRef: { current: NewThreadDraftState }
}

type UseRuntimeActionsBundleArgs = {
  core: CoreDeps
  thread: ThreadDeps
  composer: ComposerDeps
}

export function useRuntimeActionsBundle(args: UseRuntimeActionsBundleArgs) {
  const { core, thread, composer } = args

  const patchCachedInputState = (args: {
    logs: TranscriptItem[]
    input: PendingInput
    status?: 'expired' | 'canceled' | 'failed'
  }): TranscriptItem[] => {
    let changed = false
    const nextLogs = args.logs.map((item) => {
      if (item.kind !== 'tool_call') return item
      if (item.turnId !== args.input.turnId || item.toolUseId !== args.input.toolUseId) return item
      if (args.status && item.inputState?.kind === args.input.kind && item.inputState?.status === args.status) {
        return item
      }
      changed = true
      if (!args.status) {
        const { inputState: _inputState, ...rest } = item
        return rest
      }
      return {
        ...item,
        inputState: {
          kind: args.input.kind,
          status: args.status,
        },
      }
    })
    return changed ? nextLogs : args.logs
  }

  const hasTurnFooter = (logs: TranscriptItem[], turnId: string): boolean =>
    logs.some((item) => item.kind === 'turn_footer' && item.turnId === turnId)

  const threadActionsState = useMemo(
    () => ({
      get activeThreadId() {
        return thread.activeThreadIdRef.current
      },
      get activeTurnId() {
        return thread.activeTurnIdRef.current
      },
      get selectedInputId() {
        return thread.selectedInputIdRef.current
      },
      get pendingInputs() {
        return thread.pendingInputsRef.current
      },
      get logs() {
        return thread.stateLogsRef.current
      },
      get threads() {
        return thread.threadsRef.current
      },
    }),
    [
      thread.activeThreadIdRef,
      thread.activeTurnIdRef,
      thread.pendingInputsRef,
      thread.selectedInputIdRef,
      thread.stateLogsRef,
      thread.threadsRef,
    ],
  )

  const {
    createThreadOnServerInCwd,
    activateCreatedThread,
    startThread,
    startThreadInCwd,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
  } = useMemo(
    () =>
      createThreadActions({
        get selectedCwd() {
          return thread.selectedCwdRef.current
        },
        setSelectedCwd: thread.setSelectedCwd,
        createdThreadCwdByIdRef: thread.createdThreadCwdByIdRef,
        state: threadActionsState,
        get sortedThreads() {
          return thread.sortedThreadsRef.current
        },
        get logsByThreadId() {
          return thread.logsByThreadIdRef.current
        },
        request: core.request,
        dispatch: core.dispatch,
        log: core.log,
        setMode: thread.setMode,
        cacheThreadMode: thread.cacheThreadMode,
        runtimeStateByThreadRef: thread.runtimeStateByThreadRef,
        replayCursorByThreadRef: thread.replayCursorByThreadRef,
        activeThreadIdRef: thread.activeThreadIdRef,
        setIsThreadActionBusy: thread.setIsThreadActionBusy,
        replayThreadEvents: thread.replayThreadEvents,
        resumeThreadInputs: thread.resumeThreadInputs,
        refreshThreads: thread.refreshThreads,
        refreshWorkspaceDiff: thread.refreshWorkspaceDiff,
        trackArchiveOp: ({ opId, threadId, thread: archivedThread }) => {
          thread.pendingArchiveOpsRef.current.set(opId, { threadId, thread: archivedThread ?? null })
          thread.pruneThreadScopedRuntimeRefs(thread.threadsRef.current)
        },
        clearArchiveOp: (opId) => {
          return thread.pendingArchiveOpsRef.current.delete(opId)
        },
        loadEarlierHistoryAction: thread.loadEarlierHistoryAction,
      }),
    [
      core.dispatch,
      core.log,
      core.request,
      threadActionsState,
      thread.activeThreadIdRef,
      thread.cacheThreadMode,
      thread.createdThreadCwdByIdRef,
      thread.loadEarlierHistoryAction,
      thread.logsByThreadIdRef,
      thread.pendingArchiveOpsRef,
      thread.pruneThreadScopedRuntimeRefs,
      thread.refreshThreads,
      thread.refreshWorkspaceDiff,
      thread.replayCursorByThreadRef,
      thread.replayThreadEvents,
      thread.resumeThreadInputs,
      thread.runtimeStateByThreadRef,
      thread.selectedCwdRef,
      thread.setIsThreadActionBusy,
      thread.setMode,
      thread.setSelectedCwd,
      thread.sortedThreadsRef,
      thread.threadsRef,
    ],
  )

  useEffect(() => {
    thread.selectThreadRef.current = selectThread
  }, [thread.selectThreadRef, selectThread])

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () => {
      const retirePendingInputLocally = (args: {
        input: PendingInput
        status?: 'expired' | 'canceled' | 'failed'
        reason?: string
      }) => {
        const updateCachedLogs = (logs: TranscriptItem[] | undefined) => {
          if (!logs) return null
          const siblingPendingInputExists = Object.values(
            thread.runtimeStateByThreadRef.current[args.input.threadId]?.pendingInputs ?? {},
          ).some(
            (pending) =>
              pending.inputId !== args.input.inputId &&
              pending.turnId === args.input.turnId &&
              pending.toolUseId === args.input.toolUseId,
          )
          if (siblingPendingInputExists) return null
          const nextLogs = patchCachedInputState({
            logs,
            input: args.input,
            status: args.status,
          })
          if (nextLogs === logs) return null
          thread.logsByThreadIdRef.current = {
            ...thread.logsByThreadIdRef.current,
            [args.input.threadId]: nextLogs,
          }
          thread.setLogsByThreadId((prev) => ({
            ...prev,
            [args.input.threadId]: nextLogs,
          }))
          return nextLogs
        }

        const ts = new Date(composer.nowMs()).toISOString()
        const runtimeState = thread.runtimeStateByThreadRef.current[args.input.threadId]
        if (runtimeState?.pendingInputs[args.input.inputId]) {
          const nextPendingInputs = { ...runtimeState.pendingInputs }
          delete nextPendingInputs[args.input.inputId]
          thread.runtimeStateByThreadRef.current[args.input.threadId] = {
            ...runtimeState,
            pendingInputs: nextPendingInputs,
            updatedAt: ts,
          }
        }

        const replaySeq =
          thread.replayCursorByThreadRef.current[args.input.threadId] ??
          thread.runtimeStateByThreadRef.current[args.input.threadId]?.lastReplaySeq ??
          1
        if (args.status) {
          const payload =
            args.input.payload && typeof args.input.payload === 'object'
              ? (args.input.payload as Record<string, unknown>)
              : null
          const toolName =
            payload && typeof payload.toolName === 'string' && payload.toolName.trim().length > 0
              ? payload.toolName
              : undefined
          const event: CanonicalEvent = {
            schemaVersion: 1,
            kind: 'tool_input_state',
            threadId: args.input.threadId,
            turnId: args.input.turnId,
            toolUseId: args.input.toolUseId,
            inputKind: args.input.kind,
            status: args.status,
            ...(toolName ? { toolName } : {}),
            replaySeq,
            eventId: `local:${args.input.threadId}:${args.input.turnId}:${args.input.inputId}:${args.status}`,
            ts,
            source: 'ui',
          }
          if (thread.activeThreadIdRef.current === args.input.threadId) {
            const activeLogs = thread.stateLogsRef.current
            if (hasTurnFooter(activeLogs, args.input.turnId)) {
              const nextLogs = updateCachedLogs(activeLogs)
              if (nextLogs) {
                core.dispatch({
                  type: 'replace_logs',
                  logs: nextLogs,
                })
              }
            } else {
              core.dispatch({
                type: 'apply_canonical_event',
                event,
              })
            }
          } else {
            updateCachedLogs(thread.logsByThreadIdRef.current[args.input.threadId])
          }
        } else if (thread.activeThreadIdRef.current === args.input.threadId) {
          const nextLogs = updateCachedLogs(thread.stateLogsRef.current)
          if (nextLogs) {
            core.dispatch({
              type: 'replace_logs',
              logs: nextLogs,
            })
          }
        } else {
          updateCachedLogs(thread.logsByThreadIdRef.current[args.input.threadId])
        }

        core.dispatch({
          type: 'input_resolved',
          inputId: args.input.inputId,
          status: args.status,
          ...(args.reason ? { reason: args.reason } : {}),
        })
      }

      return createComposerActions({
        inputText: composer.inputText,
        setInputText: composer.setInputText,
        isSendingTurn: composer.isSendingTurn,
        isInterruptingTurn: composer.isInterruptingTurn,
        isSubmittingInput: composer.isSubmittingInput,
        mode: composer.mode,
        activeThreadId: composer.activeThreadId,
        activeTurnId: composer.activeTurnId,
        newThreadDraft: composer.newThreadDraft,
        resolveRequestCwd: (threadId) => {
          const activeThread = thread.threadsRef.current.find((threadItem) => threadItem.id === threadId)
          return activeThread?.cwd ?? thread.createdThreadCwdByIdRef.current[threadId] ?? thread.selectedCwdRef.current ?? null
        },
        getPendingInputById: (inputId) => thread.pendingInputsRef.current[inputId],
        request: core.request,
        dispatch: core.dispatch,
        log: core.log,
        commandByTurnRef: composer.commandByTurnRef,
        setIsSendingTurn: composer.setIsSendingTurn,
        setIsInterruptingTurn: composer.setIsInterruptingTurn,
        setIsSubmittingInput: composer.setIsSubmittingInput,
        setSubmitStatusByInputId: composer.setSubmitStatusByInputId,
        toRpcError: composer.toRpcError,
        nowMs: composer.nowMs,
        startThread,
        createThreadOnServerInCwd,
        activateCreatedThread,
        leaveNewThreadDraft: composer.leaveNewThreadDraft,
        refreshThreads: thread.refreshThreads,
        refreshWorkspaceDiff: thread.refreshWorkspaceDiff,
        getCurrentActiveThreadId: () => thread.activeThreadIdRef.current,
        getCurrentNewThreadDraft: () => composer.newThreadDraftRef.current,
        retirePendingInputLocally,
      })
    },
    [
      activateCreatedThread,
      core.dispatch,
      core.log,
      core.request,
      composer.activeThreadId,
      composer.activeTurnId,
      composer.commandByTurnRef,
      composer.inputText,
      composer.isInterruptingTurn,
      composer.isSendingTurn,
      composer.isSubmittingInput,
      composer.mode,
      composer.newThreadDraft,
      composer.nowMs,
      composer.setInputText,
      composer.setIsInterruptingTurn,
      composer.setIsSendingTurn,
      composer.setIsSubmittingInput,
      composer.setSubmitStatusByInputId,
      composer.toRpcError,
      composer.leaveNewThreadDraft,
      composer.newThreadDraftRef,
      createThreadOnServerInCwd,
      startThread,
      thread.activeThreadIdRef,
      thread.createdThreadCwdByIdRef,
      thread.logsByThreadIdRef,
      thread.pendingInputsRef,
      thread.replayCursorByThreadRef,
      thread.refreshThreads,
      thread.refreshWorkspaceDiff,
      thread.runtimeStateByThreadRef,
      thread.selectedCwdRef,
      thread.setLogsByThreadId,
      thread.stateLogsRef,
      thread.threadsRef,
    ],
  )

  return {
    createThreadOnServerInCwd,
    activateCreatedThread,
    startThread,
    startThreadInCwd,
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
    interruptTurn,
    submitInputById,
    onSend,
  }
}
