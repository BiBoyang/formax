import { useEffect, useMemo } from 'react'
import type { ArchiveThreadLike } from '../../semantics'
import type { PendingInput, TranscriptItem } from '../../types'
import { createComposerActions, type ComposerActionsContext } from './composerActions'
import {
  createThreadActions,
  type SelectThreadOptions,
  type ThreadActionsContext,
} from './threadActions'
import type { ThreadListItem } from './orchestrator/threadTransactions'

type UseRuntimeActionsBundleArgs = {
  request: ThreadActionsContext['request']
  dispatch: ThreadActionsContext['dispatch']
  log: ThreadActionsContext['log']
  selectedCwdRef: { current: string | null }
  setSelectedCwd: ThreadActionsContext['setSelectedCwd']
  activeThreadIdRef: ThreadActionsContext['activeThreadIdRef']
  activeTurnIdRef: { current: string | null }
  selectedInputIdRef: { current: string | null }
  pendingInputsRef: { current: Record<string, PendingInput> }
  stateLogsRef: { current: TranscriptItem[] }
  threadsRef: { current: ThreadListItem[] }
  sortedThreadsRef: { current: ThreadListItem[] }
  logsByThreadIdRef: { current: Record<string, TranscriptItem[]> }
  runtimeStateByThreadRef: ThreadActionsContext['runtimeStateByThreadRef']
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
  inputText: ComposerActionsContext['inputText']
  setInputText: ComposerActionsContext['setInputText']
  isSendingTurn: ComposerActionsContext['isSendingTurn']
  isInterruptingTurn: ComposerActionsContext['isInterruptingTurn']
  isSubmittingInput: ComposerActionsContext['isSubmittingInput']
  mode: ComposerActionsContext['mode']
  activeThreadId: ComposerActionsContext['activeThreadId']
  activeTurnId: ComposerActionsContext['activeTurnId']
  commandByTurnRef: ComposerActionsContext['commandByTurnRef']
  setIsSendingTurn: ComposerActionsContext['setIsSendingTurn']
  setIsInterruptingTurn: ComposerActionsContext['setIsInterruptingTurn']
  setIsSubmittingInput: ComposerActionsContext['setIsSubmittingInput']
  setSubmitStatusByInputId: ComposerActionsContext['setSubmitStatusByInputId']
  toRpcError: ComposerActionsContext['toRpcError']
  nowMs: ComposerActionsContext['nowMs']
}

export function useRuntimeActionsBundle(args: UseRuntimeActionsBundleArgs) {
  const threadActionsState = useMemo(
    () => ({
      get activeThreadId() {
        return args.activeThreadIdRef.current
      },
      get activeTurnId() {
        return args.activeTurnIdRef.current
      },
      get selectedInputId() {
        return args.selectedInputIdRef.current
      },
      get pendingInputs() {
        return args.pendingInputsRef.current
      },
      get logs() {
        return args.stateLogsRef.current
      },
      get threads() {
        return args.threadsRef.current
      },
    }),
    [
      args.activeThreadIdRef,
      args.activeTurnIdRef,
      args.pendingInputsRef,
      args.selectedInputIdRef,
      args.stateLogsRef,
      args.threadsRef,
    ],
  )

  const {
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
          return args.selectedCwdRef.current
        },
        setSelectedCwd: args.setSelectedCwd,
        state: threadActionsState,
        get sortedThreads() {
          return args.sortedThreadsRef.current
        },
        get logsByThreadId() {
          return args.logsByThreadIdRef.current
        },
        request: args.request,
        dispatch: args.dispatch,
        log: args.log,
        setMode: args.setMode,
        runtimeStateByThreadRef: args.runtimeStateByThreadRef,
        replayCursorByThreadRef: args.replayCursorByThreadRef,
        activeThreadIdRef: args.activeThreadIdRef,
        setIsThreadActionBusy: args.setIsThreadActionBusy,
        replayThreadEvents: args.replayThreadEvents,
        resumeThreadInputs: args.resumeThreadInputs,
        refreshThreads: args.refreshThreads,
        refreshWorkspaceDiff: args.refreshWorkspaceDiff,
        trackArchiveOp: ({ opId, threadId, thread }) => {
          args.pendingArchiveOpsRef.current.set(opId, { threadId, thread: thread ?? null })
          args.pruneThreadScopedRuntimeRefs(args.threadsRef.current)
        },
        clearArchiveOp: (opId) => {
          return args.pendingArchiveOpsRef.current.delete(opId)
        },
        loadEarlierHistoryAction: args.loadEarlierHistoryAction,
      }),
    [
      args.activeThreadIdRef,
      args.dispatch,
      args.loadEarlierHistoryAction,
      args.log,
      args.logsByThreadIdRef,
      args.pendingArchiveOpsRef,
      args.pruneThreadScopedRuntimeRefs,
      args.refreshThreads,
      args.refreshWorkspaceDiff,
      args.replayCursorByThreadRef,
      args.replayThreadEvents,
      args.request,
      args.resumeThreadInputs,
      args.runtimeStateByThreadRef,
      args.selectedCwdRef,
      args.setIsThreadActionBusy,
      args.setMode,
      args.setSelectedCwd,
      args.sortedThreadsRef,
      args.threadsRef,
      threadActionsState,
    ],
  )

  useEffect(() => {
    args.selectThreadRef.current = selectThread
  }, [args.selectThreadRef, selectThread])

  const { interruptTurn, submitInputById, onSend } = useMemo(
    () =>
      createComposerActions({
        inputText: args.inputText,
        setInputText: args.setInputText,
        isSendingTurn: args.isSendingTurn,
        isInterruptingTurn: args.isInterruptingTurn,
        isSubmittingInput: args.isSubmittingInput,
        mode: args.mode,
        activeThreadId: args.activeThreadId,
        activeTurnId: args.activeTurnId,
        resolveRequestCwd: (threadId) => {
          const activeThread = args.threadsRef.current.find((thread) => thread.id === threadId)
          return args.selectedCwdRef.current ?? activeThread?.cwd ?? null
        },
        getPendingInputById: (inputId) => args.pendingInputsRef.current[inputId],
        request: args.request,
        dispatch: args.dispatch,
        log: args.log,
        commandByTurnRef: args.commandByTurnRef,
        setIsSendingTurn: args.setIsSendingTurn,
        setIsInterruptingTurn: args.setIsInterruptingTurn,
        setIsSubmittingInput: args.setIsSubmittingInput,
        setSubmitStatusByInputId: args.setSubmitStatusByInputId,
        toRpcError: args.toRpcError,
        nowMs: args.nowMs,
        startThread,
      }),
    [
      args.activeThreadId,
      args.activeTurnId,
      args.commandByTurnRef,
      args.dispatch,
      args.inputText,
      args.isInterruptingTurn,
      args.isSendingTurn,
      args.isSubmittingInput,
      args.log,
      args.mode,
      args.nowMs,
      args.pendingInputsRef,
      args.request,
      args.selectedCwdRef,
      args.setInputText,
      args.setIsInterruptingTurn,
      args.setIsSendingTurn,
      args.setIsSubmittingInput,
      args.setSubmitStatusByInputId,
      args.threadsRef,
      args.toRpcError,
      startThread,
    ],
  )

  return {
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
